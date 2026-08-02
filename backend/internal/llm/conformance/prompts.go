package conformance

// Where the prompts come from.
//
// The suite must exercise the prompts the product actually ships, not a copy of
// them. A copy is worse than useless: it would drift, and a provider would then
// be scored against text no user ever sends it — the suite would keep reporting
// 96% while the real pipeline degraded.
//
// The prompts live as unexported constants in internal/ask/prompts.go, and this
// package cannot import them. So it reads them out of the source file with
// go/ast. That is deliberate rather than expedient: it means renaming a prompt
// constant breaks this suite loudly at the point of the rename, which is
// exactly when someone should be asked whether the conformance cases still
// cover the pipeline.

import (
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
)

// The four system prompts the ask pipeline issues, by constant name in
// internal/ask/prompts.go. Verified against the call sites in pipeline.go:
// planSystem (:274), alternatesSystem (:318), crossSystem (:357),
// presentSystem (:490).
const (
	constPlan       = "planSystem"
	constAlternates = "alternatesSystem"
	constCross      = "crossSystem"
	constPresent    = "presentSystem"
)

// Prompts holds the live system prompts read from source.
type Prompts struct {
	Plan       string
	Alternates string
	Cross      string
	Present    string
}

// LoadPrompts parses internal/ask/prompts.go and returns the four system
// prompts. An error here means the pipeline changed shape and the suite needs a
// human, which is the correct outcome.
func LoadPrompts() (*Prompts, error) {
	path := filepath.Join(repoRoot(), "backend", "internal", "ask", "prompts.go")
	if _, err := os.Stat(path); err != nil {
		return nil, fmt.Errorf("conformance: cannot read the shipped prompts at %s: %w", path, err)
	}

	fset := token.NewFileSet()
	file, err := parser.ParseFile(fset, path, nil, 0)
	if err != nil {
		return nil, fmt.Errorf("conformance: parse %s: %w", path, err)
	}

	consts := map[string]string{}
	// Two passes: string constants can reference each other (planSystem is
	// built from sqlRules), and declaration order is not dependency order.
	for range 2 {
		for _, decl := range file.Decls {
			gen, ok := decl.(*ast.GenDecl)
			if !ok || gen.Tok != token.CONST {
				continue
			}
			for _, spec := range gen.Specs {
				vs, ok := spec.(*ast.ValueSpec)
				if !ok || len(vs.Names) != 1 || len(vs.Values) != 1 {
					continue
				}
				if v, ok := evalString(vs.Values[0], consts); ok {
					consts[vs.Names[0].Name] = v
				}
			}
		}
	}

	out := &Prompts{
		Plan:       consts[constPlan],
		Alternates: consts[constAlternates],
		Cross:      consts[constCross],
		Present:    consts[constPresent],
	}
	for name, got := range map[string]string{
		constPlan: out.Plan, constAlternates: out.Alternates,
		constCross: out.Cross, constPresent: out.Present,
	} {
		if got == "" {
			return nil, fmt.Errorf(
				"conformance: %s not found in %s — the ask pipeline's prompts were renamed or restructured; "+
					"update internal/llm/conformance/prompts.go and re-check that the cases still cover every model call",
				name, path)
		}
	}
	return out, nil
}

// evalString folds the string-literal expressions used in prompts.go: plain
// literals and `+` concatenation of literals and other string constants.
func evalString(e ast.Expr, consts map[string]string) (string, bool) {
	switch n := e.(type) {
	case *ast.BasicLit:
		if n.Kind != token.STRING {
			return "", false
		}
		s, err := strconv.Unquote(n.Value)
		if err != nil {
			return "", false
		}
		return s, true
	case *ast.Ident:
		v, ok := consts[n.Name]
		return v, ok
	case *ast.BinaryExpr:
		if n.Op != token.ADD {
			return "", false
		}
		l, lok := evalString(n.X, consts)
		r, rok := evalString(n.Y, consts)
		if !lok || !rok {
			return "", false
		}
		return l + r, true
	}
	return "", false
}

// repoRoot walks up from this source file to the directory holding backend/.
func repoRoot() string {
	_, this, _, ok := runtime.Caller(0)
	if !ok {
		return ""
	}
	// .../backend/internal/llm/conformance/prompts.go -> up four
	return filepath.Clean(filepath.Join(filepath.Dir(this), "..", "..", "..", ".."))
}
