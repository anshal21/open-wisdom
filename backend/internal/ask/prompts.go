package ask

import (
	"fmt"
	"strings"

	"github.com/anshal21/ai-analyst/backend/internal/store"
)

// planReply is the assembled plan: the reading the system would answer with,
// followed by every other defensible reading of the same question.
//
// The two halves are produced by two calls issued at the same instant, and the
// reason is latency. Enumerating alternate readings means writing a full query
// for each, and output length is what a model spends its time on — folding that
// into the primary call made an ambiguous question take half again as long as
// an unambiguous one, which is backwards, because a refusal is the answer that
// most needs to arrive quickly. Split, an unambiguous question pays nothing:
// the enumeration call returns an empty list and finishes first.
//
// Neither call decides whether the question is ambiguous. They only enumerate.
// The decision is made downstream by executing every reading and measuring how
// far apart the answers actually are.
type planReply struct {
	Restated     string    `json:"restated"`
	Assumptions  []string  `json:"assumptions"`
	Unit         string    `json:"unit"`
	FormatHint   string    `json:"format_hint"`
	DefinitionID string    `json:"definition_id"`
	Label        string    `json:"label"`
	SQL          string    `json:"sql"`
	Readings     []reading `json:"readings"`
}

// altReply is the enumeration call's output.
type altReply struct {
	Readings []reading `json:"readings"`
}

type reading struct {
	Label       string `json:"label"`
	Description string `json:"description"`
	SQL         string `json:"sql"`
}

type chartHint struct {
	Type   string   `json:"type"`
	X      string   `json:"x"`
	Y      []string `json:"y"`
	Series string   `json:"series"`
}

// presentReply is the Present module's output: how the answer reads, and how
// it should look — judged with the actual result in view. agents.md §4.
type presentReply struct {
	Markdown string    `json:"markdown"`
	Chart    chartHint `json:"chart"`
}

type crossReply struct {
	SQL      string `json:"sql"`
	Approach string `json:"approach"`
}

// sqlRules are shared by every prompt that writes a query, so the guarantees
// the guard and the checks depend on are stated once.
const sqlRules = `Query rules:
- Read-only. A single SELECT or WITH statement. No semicolon-separated statements, no DDL, no DML.
- Use only tables and columns that appear in the schema. Never invent one.
- String literals must match the measured distinct values EXACTLY, including capitalization. The profiles list the real values; use them verbatim.
- Prefer explicit joins on the documented keys. Do not join through a column just because the names match.
- No trailing semicolon.`

const planSystem = `You are a meticulous senior analytics engineer. You turn a business question into SQL against a warehouse whose schema and measured column profiles are given to you.

Write the ONE query you would answer with, and state plainly what you assumed to get there. Another analyst is separately enumerating the other defensible readings, so do not enumerate alternatives here — commit to the reading you judge most likely to be meant.

` + sqlRules + `

Respond with exactly this JSON:
{
  "restated": "one sentence restating the question the way you will answer it",
  "assumptions": ["each material choice you made, in plain English, one per item"],
  "unit": "currency|count|percent|ratio|duration|none",
  "format_hint": "currency|integer|decimal|percent",
  "definition_id": "id of the ratified definition you applied, or empty string",
  "label": "short noun phrase, under 6 words, naming the reading you committed to in business terms",
  "sql": "SELECT ..."
}`

const alternatesSystem = `You audit questions for ambiguity against a specific warehouse.

Enumerate every materially different reading of the question that a competent analyst could defend, and write the query for each. You are NOT choosing between them and you are NOT answering the question. You are establishing whether the question has one answer or several.

A reading is materially different when it changes WHICH ROWS or WHICH GRAIN the measure is computed over. The evidence must come from the schema and the measured profiles you were given. Typical sources:
- The measure exists on more than one table, at a different grain on each.
- A state/status/type column has values a reasonable person might include or exclude, and the question does not say which.
- The population of an entity can be defined by existence in one table or by an activity condition in another.
- More than one date column could define when the thing "happened".
- A column's stored values split one real entity across several spellings, so grouping or filtering as stored gives a different population from grouping canonically.

A reading is NOT materially different when it only changes formatting, ordering, column aliases, or rewrites the same predicate another way. Do not pad the list to look thorough — every reading you add that is not genuinely defensible makes the system interrupt a user who did not need interrupting.

MOST QUESTIONS HAVE EXACTLY ONE READING. Returning an empty list is the correct and common answer, and it is the fast one.

HARD LIMITS. A person is waiting for this, and every token you spend on presentation is a token of their time:
- At most TWO readings, the two most likely to be what was meant. Two is enough: another analyst is separately committing to a reading of their own, so two from you makes three, and three measured figures either agree or establish a spread.
- Each query is the SHORTEST correct statement that returns the figure: no CTEs, no comments, no column aliases, no line breaks, no formatting.
- "description" is at most twelve words.
- Emit the JSON object and nothing else.

Every query must return the SAME SHAPE the question implies: if the question asks for one number, every reading returns exactly one row and one column.

` + sqlRules + `

Respond with:
{"readings":[{"label":"short noun phrase, under 6 words","description":"one sentence naming the exact rows this includes","sql":"SELECT ..."}]}

Write plain English in "label" and "description" — a business user reads them, so name the business meaning, not the predicate.`

const crossSystem = `You are a senior analytics engineer performing an INDEPENDENT re-derivation.

Another analyst is answering the same question right now. You cannot see their query and they cannot see yours. The point of the exercise is that two people who reach the same figure by different routes are far more likely to be right than one person who reached it once.

Your job: reach the answer by a DIFFERENT PATH than the most obvious one, wherever a different path exists. Aggregate from a different table, route through a different join, reconstruct the measure from its components, or compute it as a difference of two other quantities — whatever the schema genuinely supports. If the schema truly offers only one path, write that path.

Rules:
- Read-only. A single SELECT or WITH statement.
- Only tables and columns that appear in the schema.
- String literals must match the measured distinct values EXACTLY, including capitalization.
- Return exactly the same shape the question asks for: one number for a "what was X" question.
- If the question admits several readings, take the most inclusive, simplest reading and say so in "approach".

Respond with:
{"sql":"SELECT ...","approach":"one sentence naming the path you took and why it is independent"}`

const presentSystem = `The query has ALREADY been run against the warehouse and its result is given to you below. You have no database to query and none is needed. You are the presenter: you decide how this result reads and how it should look. Two outputs.

NARRATIVE — the one or two sentence answer a good senior analyst sends to a colleague, using the figures you were handed.
- State the number and what it measures, in business terms. If an assumption materially shaped it, name that assumption. Then stop.
- Maximum two sentences. Shorter is better. One sentence is often right.
- Use only the figures given to you. Never introduce a number that is not in the input.
- Do NOT hedge, do NOT invent a caveat, and do NOT mention verification, checks, or confidence. A separate step appends the real caveat verbatim, and anything you guess at will contradict it.
- Never restate the SQL. Never explain what a join is. Never use the words "I", "we", or "the system".
- No preamble, no sign-off, no bullet points.

CHART — a suggestion for how to visualize this exact result, judged from the columns and rows you can SEE, and from what the question asked for.
- "type": one of line, bar, area, pie, scatter, table, scalar. Empty string when you have no opinion.
- Time on x reads as a line. Ranked categories and share-of-whole read as a bar. A single number is a scalar. Never volunteer a pie — suggest it ONLY when the asker named that form.
- If the asker NAMED a chart form ("as a pie chart", "plot a line"), honor it — the asker outranks your taste.
- "x"/"series": column names from the result, or empty. "y": measure column names, or empty.
- Copy column names EXACTLY as they appear in RESULT, including any alias. If the column is "total_sale_price", write "total_sale_price" — not "sale_price". A name that is not in RESULT is worse than an empty string.
- The suggestion is not a mandate: a deterministic layer arbitrates it against the data shape, and the user can override it. Suggest boldly, hold loosely.

Respond with: {"markdown":"...","chart":{"type":"","x":"","y":[],"series":""}}`

// buildPrompt assembles the question, its context, the ratified vocabulary, and
// the profiled schema.
//
// All three planning calls receive exactly this, so they start from identical
// evidence. That equality is what makes their disagreement meaningful: if the
// independent derivation reaches a different figure, it is not because it was
// told less.
func buildPrompt(question, digest string, defs []store.Definition, c *store.Context, history string) string {
	var b strings.Builder
	b.WriteString("QUESTION: " + question + "\n\n")
	if history != "" {
		b.WriteString(history + "\n")
	}
	if s := describeContext(c); s != "" {
		b.WriteString(s + "\n")
	}
	if s := describeDefinitions(defs, pinnedID(c)); s != "" {
		b.WriteString(s + "\n")
	}
	b.WriteString("SCHEMA AND MEASURED PROFILES:\n\n")
	b.WriteString(digest)
	return b.String()
}

// describeContext renders the editable chips. They are constraints, not hints:
// a pinned definition or an explicit time range removes a degree of freedom
// from the planner and therefore removes an ambiguity.
func describeContext(c *store.Context) string {
	if c == nil {
		return ""
	}
	var lines []string
	if c.TimeRange != nil && (c.TimeRange.From != "" || c.TimeRange.To != "") {
		lines = append(lines, fmt.Sprintf("  time range: %s to %s (inclusive)", c.TimeRange.From, c.TimeRange.To))
	}
	for _, f := range c.Filters {
		lines = append(lines, fmt.Sprintf("  filter: %s %s %v", f.Column, f.Operator, f.Value))
	}
	if c.Grain != "" {
		lines = append(lines, "  grain: "+c.Grain)
	}
	if len(lines) == 0 {
		return ""
	}
	return "ACTIVE CONTEXT — apply every one of these, they are not optional:\n" + strings.Join(lines, "\n") + "\n"
}

// describeDefinitions renders the ratified vocabulary. A ratified definition is
// binding: it is the resolution a human already made, and re-litigating it is
// exactly the behavior the product exists to eliminate.
func describeDefinitions(defs []store.Definition, pinnedID string) string {
	if len(defs) == 0 {
		return ""
	}
	var b strings.Builder
	b.WriteString("RATIFIED DEFINITIONS — a human has already settled what each of these terms means. If one covers a term in the question you MUST apply it exactly, name its id in \"definition_id\" if you are asked for one, and treat that term as unambiguous: there is nothing left to enumerate about a question a human has already answered.\n")
	for _, d := range defs {
		marker := ""
		if d.ID == pinnedID {
			marker = "  <-- THE ASKER PINNED THIS ONE. Use it, whatever else looks applicable."
		}
		fmt.Fprintf(&b, "  [%s] %s (v%d): %s%s\n", d.ID, d.Name, d.Version, d.PlainEnglish, marker)
		if d.Expression != "" {
			fmt.Fprintf(&b, "      expression: %s\n", d.Expression)
		}
	}
	return b.String()
}

func pinnedID(c *store.Context) string {
	if c == nil {
		return ""
	}
	return c.DefinitionID
}
