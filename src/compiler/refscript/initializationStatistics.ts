//<reference path='..\typescript.ts' />

module ts {

    export class StatsContext {
        constructor(private _diagnostics: Diagnostic[]) { }

        private _inCtor = false;
        private _inAsgn = false;
        private _inMemAccess = false;

        public enteringCtor() {
            this._inCtor = true;
        }

        public exitingCtor() {
            this._inCtor = false;
        }

        public inCtor(): boolean {
            return this._inCtor;
        }

        private _validIds: any = {};

        public registerValidId(id: number): void {
            this._validIds[id] = true;
        }

        public isValidId(id: number): boolean {
            return (id in this._validIds);
        }

        public postDiagnostic(diagnostic: Diagnostic) {
            this._diagnostics.push(diagnostic);
        }

    }

    export class InitializationValidator {

        static astToSourceSpan(ast: Node) {
            let file = getSourceFileOfNode(ast);
            let start = getLineAndCharacterOfPosition(file, ast.pos);
            let stop = getLineAndCharacterOfPosition(file, ast.end);
            return new RsSrcSpan(file.fileName, start, stop);
        }


        public validate(document: SourceFile, diagnostics: Diagnostic[]) {

            // var sourceUnit = document;
            let context = new StatsContext(diagnostics);

            traverse(document);

            return;

            function pre(ast: Node) {

                if (SyntaxKind.BinaryExpression && (<BinaryExpression>ast).operatorToken.kind === SyntaxKind.EqualsToken) {
                    // register a assignment of the form:
                    // this._ = _;
                    if (context.inCtor()) {
                        var asgnExpr = <BinaryExpression>ast;
                        var lhsAsgn = asgnExpr.left;
                        if (lhsAsgn.kind === SyntaxKind.ElementAccessExpression) {
                            var memAccess = <ElementAccessExpression>lhsAsgn;
                            if (memAccess.expression.kind === SyntaxKind.ThisKeyword) {
                                context.registerValidId(memAccess.expression.id);
                            }
                        }
                    }
                    return;
                }

                switch (ast.kind) {
                    case SyntaxKind.Constructor:
                        //console.log("In constructor declaration" + astToSourceSpan(ast).toString());
                        context.enteringCtor();
                        break;

                    case SyntaxKind.FunctionDeclaration:
                        // Functions Constructor
                        var funcName = (<FunctionDeclaration>ast).name.text;		// TODO: what if there is no name?
                        if (/^[A-Z]/.test(funcName)) context.enteringCtor();
                        break;

                    case SyntaxKind.ThisKeyword:
                        if (context.inCtor()) {
                            if (!context.isValidId(ast.id)) {
                                context.postDiagnostic(createDiagnosticForNode(ast, Diagnostics.Invalid_reference_of_this_in_constructor));
                                //console.log("INVALID: " + InitializationValidator.astToSourceSpan(ast).toString());
                            }
                        }
                        break;
                }
            }

            function post(ast: Node) {
                switch (ast.kind) {
                    case SyntaxKind.Constructor:
                        context.exitingCtor();
                        break;
                }
            }

            function traverse(node: Node) {
                pre(node);
                forEachChild(node, traverse);
                post(node);
            }

        }

    }

}
