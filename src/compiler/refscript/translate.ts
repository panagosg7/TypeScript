//<reference path='..\typescript.ts' />
/// <reference path="./initializationStatistics.ts"/>
/// <reference path="./syntax.ts"/>
/// <reference path="./annotations.ts"/>
/// <reference path="./types.ts"/>
/// <reference path="../../../ext/json-stringify-pretty-compact/index.ts"/>

namespace ts {

    export class RsTranslationState {
        private _initValidator = new InitializationValidator();

        private diagnosticCollection: DiagnosticCollection = createDiagnosticCollection();

        public error(location: Node, message: DiagnosticMessage, arg0?: any, arg1?: any, arg2?: any): void {
            let diagnostic = location
                ? createDiagnosticForNode(location, message, arg0, arg1, arg2)
                : createCompilerDiagnostic(message, arg0, arg1, arg2);
            this.diagnosticCollection.add(diagnostic);
        }

        public diagnostics(): Diagnostic[] {
            return this.diagnosticCollection.getDiagnostics();;
        }
    }

    export class FixResult {
        public serialize() {
            throw new Error("FixResult.serialize - abstract");
        }
    }

    export class FPSrcPos {
        constructor(private name: string, private line: number, private column: number) { }

        public serialize() {
            return [this.name, this.line + 1, this.column + 1]; // Calibrating off by one
            //"name": this.name, "line": this.line, "column": this.column
        }
    }

    export class FPSrcSpan {
        constructor(private sp_start: FPSrcPos, private sp_stop: FPSrcPos) { }

        public serialize(): any {
            return {
                "sp_start": this.sp_start.serialize(),
                "sp_stop": this.sp_stop.serialize()
            };
        }
    }

    export class FPError {
        constructor(private errMsg: string, private errLoc: FPSrcSpan) { }

        public serialize() {
            return {
                "errMsg": this.errMsg,
                "errLoc": this.errLoc.serialize()
            };
        }
    }

    export function mkFixError(diagnostic: Diagnostic): FPError {
        let text1 = diagnostic.messageText;
        let msg = typeof text1 === "string" ? text1 : text1.messageText;
        let file = diagnostic.file;
        let fileName = (file) ? file.fileName : "";
        let start = (file) ? getLineAndCharacterOfPosition(file, diagnostic.start) : { line: -1, character: -1 };
        let stop = (file) ? getLineAndCharacterOfPosition(file, diagnostic.start + diagnostic.length) : { line: -1, character: -1 };
        return new FPError(msg, new FPSrcSpan(new FPSrcPos(fileName, start.line, start.character), new FPSrcPos(fileName, stop.line, stop.character)));
    }

    export class FRCrash extends FixResult {
        constructor(private errs: FPError[], private msg: string) {
            super();
        }

        public serialize() {
            return aesonEncode("Crash", [this.errs.map(err => err.serialize()), this.msg]);
        }
    }

    export class FRSafe extends FixResult {
        public serialize() {
            return aesonEncode("Safe", []);
        }
    }

    export class FRUnsafe extends FixResult {
        constructor(private errs: FPError[]) {
            super();
        }

        public serialize() {
            return aesonEncode("Unsafe", this.errs.map(err => err.serialize()));
        }
    }

    export class FRUnknownError extends FixResult {
        constructor(private msg: string) {
            super();
        }

        public serialize() {
            return aesonEncode("UnknownError", this.msg);
        }
    }

    /**
     * Get the refscript source span of a node.
     * @param  Node         node    an AST node
     * @return RsSourceSpan         the wanted source span
     */
    function nodeToSrcSpan(node: Node) {
        let file = getSourceFileOfNode(node);
        let start = getLineAndCharacterOfPosition(file, node.pos);
        let stop = getLineAndCharacterOfPosition(file, node.end);
        return new RsSrcSpan(file.fileName, start, stop);
    }

    export function emitRscJSON(resolver: EmitResolver, host: EmitHost, targetSourceFile: SourceFile, checker: TypeChecker): EmitResult {
        let compilerOptions = host.getCompilerOptions();
        let languageVersion = compilerOptions.target || ScriptTarget.ES3;
        let sourceMapDataList: SourceMapData[] = compilerOptions.sourceMap || compilerOptions.inlineSourceMap ? [] : undefined;
        let diagnostics: Diagnostic[] = [];
        let newLine = host.getNewLine();

        let jsonFiles: string[] = [];

        // In RSC only the first case should be called.
        if (targetSourceFile === undefined) {
            jsonFiles = map(host.getSourceFiles(), sourceFile => {
                let jsonFilePath = getNormalizedAbsolutePath(getOwnEmitOutputFilePath(sourceFile, host, ".json"), host.getCurrentDirectory());
                diagnostics = concatenate(diagnostics, emitFile(jsonFilePath, sourceFile));
                return jsonFilePath;
            });

            if (compilerOptions.outFile || compilerOptions.out) {
                diagnostics = concatenate(diagnostics, emitFile(compilerOptions.outFile || compilerOptions.out));
            }

        }
        else {
            // RSC: this is not supposed to be triggered
            // targetSourceFile is specified (e.g calling emitter from language service or calling getSemanticDiagnostic from language service)
            if (shouldEmitToOwnFile(targetSourceFile, compilerOptions)) {
                let jsonFilePath = getOwnEmitOutputFilePath(targetSourceFile, host, ".json");
                diagnostics = concatenate(diagnostics, emitFile(jsonFilePath, targetSourceFile));
            }
            else if (!isDeclarationFile(targetSourceFile) && (compilerOptions.outFile || compilerOptions.out)) {
                diagnostics = concatenate(diagnostics, emitFile(compilerOptions.outFile || compilerOptions.out));
            }
        }

        // Sort and make the unique list of diagnostics
        diagnostics = sortAndDeduplicateDiagnostics(diagnostics);

        return {
            emitSkipped: false,
            diagnostics,
            sourceMaps: sourceMapDataList,
            jsonFiles
        };

        function emitFile(rscFilePath: string, sourceFile?: SourceFile): Diagnostic[] {
            return emitRefScript(rscFilePath, sourceFile);

            // TODO
            // if (compilerOptions.declaration) {
            //     writeDeclarationFile(rscFilePath, sourceFile, host, resolver, diagnostics);
            // }
        }


        function emitRefScript(rscFilePath: string, root?: SourceFile): Diagnostic[] {
            let writer = createTextWriter(newLine);
            let { write, writeTextOfNode, writeLine, increaseIndent, decreaseIndent } = writer;

            let currentSourceFile: SourceFile;
            // name of an exporter function if file is a System external module
            // System.register([...], function (<exporter>) {...})
            // exporting in System modules looks like:
            // export var x; ... x = 1
            // =>
            // var x;... exporter("x", x = 1)
            let exportFunctionForFile: string;

            /** Write emitted output to disk */
            let writeEmittedFiles = writeRefScriptFile;

            let detachedCommentsInfo: { nodePos: number; detachedCommentEndPos: number }[];

            let writeComment = writeCommentRange;

            /** Emit a node */
            let emit = emitRefScriptWorker;
            let diagnostics: Diagnostic[] = []

            if (root) {
                // Do not call emit directly. It does not set the currentSourceFile.
                diagnostics = concatenate(diagnostics, emitSourceFile(root));
            }
            else {
                forEach(host.getSourceFiles(), sourceFile => {
                    if (!isExternalModuleOrDeclarationFile(sourceFile)) {
                        diagnostics = concatenate(diagnostics, emitSourceFile(sourceFile));
                    }
                });
            }

            writeLine();
            writeEmittedFiles(writer.getText(), /*writeByteOrderMark*/ compilerOptions.emitBOM);
            return diagnostics;

            function emitSourceFile(sourceFile: SourceFile): Diagnostic[] {
                currentSourceFile = sourceFile;
                exportFunctionForFile = undefined;
                return emit(sourceFile);
            }

            function emitRefScriptWorker(node: Node): Diagnostic[] {
                let initState = new RsTranslationState();
                let { state, ast} = nodeToRsASTWithState(initState, node);
                let diagnostics = state.diagnostics();
                if (!compilerOptions.refscript) {
                    return diagnostics;
                }
                if (diagnostics && diagnostics.length > 0) {
                    return diagnostics;
                }
                // Write the JSON file
                write(PrettyJSON.stringify(ast.serialize(), { maxLength: 120, indent: 2 }));
                return diagnostics;
            }

            function writeRefScriptFile(emitOutput: string, writeByteOrderMark: boolean) {
                writeFile(host, diagnostics, rscFilePath, emitOutput, writeByteOrderMark);
            }

            function nodeToRsASTWithState(state: RsTranslationState, node: Node): { state: RsTranslationState; ast: RsAST } {
                switch (node.kind) {
                    case SyntaxKind.SourceFile:
                        return { state, ast: sourceFileNodeToRsAST(state, <SourceFile>node) };
                    case SyntaxKind.PropertyAssignment:
                        return { state, ast: propertyAssignmentToRsAST(state, <PropertyAssignment>node) };
                }
                state.error(node, Diagnostics.refscript_0_SyntaxKind_1_not_supported_yet, "nodeToRsAST", SyntaxKind[node.kind]);
            }

            function nodeToRsAST(state: RsTranslationState, node: Node): RsAST {
                return nodeToRsASTWithState(state, node).ast;
            }

            function accumulateGlobalAnnotations(node: Node) {
                let annotations: Annotation[] = [];
                forEachChild(node, (currentNode) => {
                    annotations = concatenate(annotations, nodeAnnotations(currentNode, makeGlobalAnnotations));
                    return false;
                });
                return annotations;
            }

            function prefixGlobalAnnotations(srcSpan: RsSrcSpan, node: Node, ast: RsAST) {
                let globalAnnotations = accumulateGlobalAnnotations(node);
                return new RsList([new RsEmptyStmt(srcSpan, globalAnnotations), ast]);
            }

            function nodeToRsExp(state: RsTranslationState, node: Expression): RsExpression {
                switch (node.kind) {
                    case SyntaxKind.BinaryExpression:
                        return binaryExpressionToRsExp(state, <BinaryExpression>node);
                    case SyntaxKind.FirstLiteralToken:
                        return literalExpressionToRsExp(state, <LiteralExpression>node);
                    case SyntaxKind.Identifier:
                        return identifierToRsExp(state, <Identifier>node);
                    case SyntaxKind.CallExpression:
                        return callExpressionToRsExp(state, <CallExpression>node);
                    case SyntaxKind.ArrayLiteralExpression:
                        return arrayLiteralExpressionToRsExp(state, <ArrayLiteralExpression>node);
                    case SyntaxKind.ElementAccessExpression:
                        return elementAccessExpressionToRsExp(state, <ElementAccessExpression>node);
                    case SyntaxKind.PropertyAccessExpression:
                        return propertyAccessExpressionToRsExp(state, <PropertyAccessExpression>node);
                    case SyntaxKind.StringLiteral:
                        return stringLiteralToRsExp(state, <StringLiteral>node);
                    case SyntaxKind.NewExpression:
                        return newExpressionToRsExp(state, <NewExpression>node);
                    case SyntaxKind.PrefixUnaryExpression:
                        return prefixUnaryExpressionToRsExp(state, <PrefixUnaryExpression>node);
                    case SyntaxKind.PostfixUnaryExpression:
                        return postfixUnaryExpressionToRsExp(state, <PostfixUnaryExpression>node);
                    case SyntaxKind.ParenthesizedExpression:
                        return parenthesizedExpressionToRsExp(state, <ParenthesizedExpression>node);
                    case SyntaxKind.TrueKeyword:
                    case SyntaxKind.FalseKeyword:
                        return boolKeywordToRsExp(state, node);
                    case SyntaxKind.FunctionExpression:
                        return functionExpressionToRsExp(state, <FunctionExpression>node);
                    case SyntaxKind.TypeOfExpression:
                        return typeOfExpressionToRsExp(state, <TypeOfExpression>node);
                    case SyntaxKind.TypeAssertionExpression:
                        return typeAssertionExpressionToRsExp(state, <TypeAssertion>node);
                    case SyntaxKind.ConditionalExpression:
                        return conditionalExpressionToRsExp(state, <ConditionalExpression>node);
                    case SyntaxKind.ObjectLiteralExpression:
                        return objectLiteralExpressionToRsExp(state, <ObjectLiteralExpression>node);
                    case SyntaxKind.SuperKeyword:
                        return superKeywordToRsExp(state, node);
                    case SyntaxKind.ThisKeyword:
                        return thisKeywordToRsExp(state, node);
                    case SyntaxKind.NullKeyword:
                        return nullKeywordToRsExp(state, node);
                }
                state.error(node, Diagnostics.refscript_0_SyntaxKind_1_not_supported_yet, "nodeToRsExp", SyntaxKind[node.kind]);
            }

            function nodeToRsLval(state: RsTranslationState, node: Expression): RsLValue {
                switch (node.kind) {
                    case SyntaxKind.Identifier:
                        return new RsLVar(nodeToSrcSpan(node), [], (<Identifier>node).text);
                    case SyntaxKind.PropertyAccessExpression:
                        return propertyAccessExpressionToRsLVal(state, <PropertyAccessExpression>node);
                    case SyntaxKind.ElementAccessExpression:
                        return elementAccessExpressionToRsLVal(state, <ElementAccessExpression>node);
                }
                state.error(node, Diagnostics.refscript_0_SyntaxKind_1_not_supported_yet, "nodeToRsLVal", SyntaxKind[node.kind]);
            }

            function nodeToRsStmt(state: RsTranslationState, node: Statement): RsStatement {
                switch (node.kind) {
                    case SyntaxKind.FunctionDeclaration:
                        return functionDeclarationToRsStmt(state, <FunctionDeclaration>node);
                    case SyntaxKind.ExpressionStatement:
                        return expressionStatementToRsStmt(state, <ExpressionStatement>node);
                    case SyntaxKind.VariableStatement:
                        return variableStatementToRsStmt(state, <VariableStatement>node);
                    case SyntaxKind.IfStatement:
                        return ifStatementToRsStmt(state, <IfStatement>node);
                    case SyntaxKind.Block:
                        return blockToRsStmt(state, <Block>node);
                    case SyntaxKind.ReturnStatement:
                        return returnStatementToRsStmt(state, <ReturnStatement>node);
                    case SyntaxKind.InterfaceDeclaration:
                        return interfaceDeclarationToRsStmt(state, <InterfaceDeclaration>node);
                    case SyntaxKind.TypeAliasDeclaration:
                        return typeAliasDeclarationToRsStmt(state, <TypeAliasDeclaration>node);
                    case SyntaxKind.ThrowStatement:
                        return throwStatementToRsStmt(state, <ThrowStatement>node);
                    case SyntaxKind.ClassDeclaration:
                        return classDeclarationToRsStmt(state, <ClassDeclaration>node);
                    case SyntaxKind.ModuleDeclaration:
                        return moduleDeclarationToRsStmt(state, <ModuleDeclaration>node);
                    case SyntaxKind.WhileStatement:
                        return whileStatementToRsStmt(state, <WhileStatement>node);
                    case SyntaxKind.EmptyStatement:
                        return emptyStatementToRsStmt(state, node);
                }
                state.error(node, Diagnostics.refscript_0_SyntaxKind_1_not_supported_yet, "nodeToRsStmt", SyntaxKind[node.kind]);
            }

            function nodeToRsClassElts(state: RsTranslationState, node: ClassElement): RsClassElt[] {
                switch (node.kind) {
                    case SyntaxKind.Constructor:
                        return constructorDeclarationToRsClassElts(state, <ConstructorDeclaration>node);
                    case SyntaxKind.MethodDeclaration:
                        return methodDeclarationToRsClassElts(state, <MethodDeclaration>node);
                    case SyntaxKind.PropertyDeclaration:
                        return propertyDeclarationToRsClassElts(state, <PropertyDeclaration>node);
                }
                state.error(node, Diagnostics.refscript_0_SyntaxKind_1_not_supported_yet, "nodeToRsClassElts", SyntaxKind[node.kind]);
            }

            /**
             * This function also gathers the global annotations.
             * @param  {RsTranslationState} state [description]
             * @param  {SourceFile}         node  [description]
             * @return {RsAST}                    [description]
             */
            function sourceFileNodeToRsAST(state: RsTranslationState, node: SourceFile): RsAST {
                let globalAnnotations = accumulateGlobalAnnotations(node);
                let astList = nodeArrayToRsAST(state, node.statements, nodeToRsStmt);
                // Caution: side effect !!!
                astList.prefixElement(new RsEmptyStmt(nodeToSrcSpan(node), globalAnnotations));
                return astList;
            }

            function nodeArrayToRsAST<S extends Node, T extends RsAST>(state: RsTranslationState, node: NodeArray<S>, mapper: (state: RsTranslationState, node: S) => T): RsList<T> {
                return new RsList(node.map(n => mapper(state, n)));
            }

            // PV: please keep rscSupportedIdKinds updated
            function nodeToRsId(state: RsTranslationState, node: Node): RsId {
                switch (node.kind) {
                    case SyntaxKind.Identifier:
                        return new RsId(nodeToSrcSpan(node), [], (<Identifier>node).text);
                    case SyntaxKind.Parameter:
                        return new RsId(nodeToSrcSpan(node), [], getTextOfNode((<ParameterDeclaration>node).name));
                }
                state.error(node, Diagnostics.refscript_0_SyntaxKind_1_not_supported_yet, "nodeToRsId", SyntaxKind[node.kind]);
            }

            // FunctionDeclaration
            function functionDeclarationToRsStmt(state: RsTranslationState, node: FunctionDeclaration): RsStatement {
                let isAmbient = !!(node.flags & NodeFlags.Ambient);
                let annotations: Annotation[] = []
                // Add the 'exported' annotation -- exported function are assumed to be top-level (are not K-vared)
                if (node.modifiers && node.modifiers.some(modifier => modifier.kind === SyntaxKind.ExportKeyword)) {
                    annotations = concatenate(annotations, [new ExportedAnnotation(nodeToSrcSpan(node))]);
                }

                let type = checker.getTypeAtLocation(node);
                let functionDeclarationAnnotations: FunctionDeclarationAnnotation[] = [];
                let nameText = node.name.text;

                node.parameters.forEach(parameter => {
                    if (parameter.initializer) {
                        state.error(node, Diagnostics.Initialization_of_parameter_0_at_the_signature_site_is_not_supported, [getTextOfNode(parameter)]);
                    }
                });

                if (isAmbient) {
                    // All 'declare' overloads should be taken into account

                    let signature = checker.getSignatureFromDeclaration(node);

                    let binderAnnotations = nodeAnnotations(node, makeFunctionDeclarationAnnotation);
                    if (binderAnnotations.length === 0) {
                        functionDeclarationAnnotations = [new FunctionDeclarationAnnotation(nodeToSrcSpan(node), nameText + " :: " + checker.functionToRscString(signature, node))];
                    }
                    else {
                        functionDeclarationAnnotations = binderAnnotations;
                    }
                }
                else if (!node.body) {
                    // Ignore the overload - it will be included in the function body type
                    return new RsEmptyStmt(nodeToSrcSpan(node), []);
                }
                else {

                    let signatures = checker.getSignaturesOfType(type, SignatureKind.Call);
                    functionDeclarationAnnotations = concat(signatures.map(signature => {
                        let signatureDeclaration = signature.declaration;
                        let sourceSpan = nodeToSrcSpan(signatureDeclaration);
                        // these are binder annotations
                        let binderAnnotations = nodeAnnotations(signatureDeclaration, makeFunctionDeclarationAnnotation);
                        if (binderAnnotations.length === 0) {
                            // No signature annotation on this declaration -> use the one TS infers
                            // return signatureToRsTFun(signature).map(functionType => new FunctionDeclarationAnnotation(sourceSpan, functionType.toString()));
                            return [new FunctionDeclarationAnnotation(sourceSpan, nameText + " :: " + checker.functionToRscString(signature, signatureDeclaration))];
                        }
                        else {
                            return binderAnnotations;
                        }
                    }));
                }

                annotations = annotations.concat(functionDeclarationAnnotations);
                return new RsFunctionStmt(nodeToSrcSpan(node), annotations, nodeToRsId(state, node.name), nodeArrayToRsAST(state, node.parameters, nodeToRsId),
                    (isAmbient) ? (new RsNothing()) : (new RsJust(new RsList(node.body.statements.map(statement => nodeToRsStmt(state, statement))))));
            }

            // Identifier
            function identifierToRsExp(state: RsTranslationState, node: Identifier): RsVarRef {
                return new RsVarRef(nodeToSrcSpan(node), [] /*token.getRsAnnotations(AnnotContext.OtherContext */, nodeToRsId(state, node));
            }

            // CallExpression
            function callExpressionToRsExp(state: RsTranslationState, node: CallExpression): RsCallExpr {
                return new RsCallExpr(nodeToSrcSpan(node), [], nodeToRsExp(state, node.expression),
                    nodeArrayToRsAST(state, node.arguments, nodeToRsExp));
            }

            // Array literal
            function arrayLiteralExpressionToRsExp(state: RsTranslationState, node: ArrayLiteralExpression): RsArrayLit {
                return new RsArrayLit(nodeToSrcSpan(node), [], nodeArrayToRsAST(state, node.elements, nodeToRsExp));
            }

            // Element Access
            function elementAccessExpressionToRsExp(state: RsTranslationState, node: ElementAccessExpression): RsBracketRef {
                return new RsBracketRef(nodeToSrcSpan(node), [], nodeToRsExp(state, node.expression), nodeToRsExp(state, node.argumentExpression));
            }

            // Property Access
            function propertyAccessExpressionToRsExp(state: RsTranslationState, node: PropertyAccessExpression): RsDotRef {
                return new RsDotRef(nodeToSrcSpan(node), [], nodeToRsExp(state, node.expression), nodeToRsId(state, node.name));
            }

            // Property Access
            function propertyAccessExpressionToRsLVal(state: RsTranslationState, node: PropertyAccessExpression): RsLValue {
                return new RsLDot(nodeToSrcSpan(node), [], nodeToRsExp(state, node.expression), getTextOfNode(node.name));
            }

            // Element Access
            function elementAccessExpressionToRsLVal(state: RsTranslationState, node: ElementAccessExpression): RsLValue {
                return new RsLBracket(nodeToSrcSpan(node), [], nodeToRsExp(state, node.expression), nodeToRsExp(state, node.argumentExpression));
            }

            // Stirng literal
            function stringLiteralToRsExp(state: RsTranslationState, node: StringLiteral): RsStringLit {
                return new RsStringLit(nodeToSrcSpan(node), [], node.text);
            }

            // New expression
            function newExpressionToRsExp(state: RsTranslationState, node: NewExpression): RsNewExpr {
                return new RsNewExpr(nodeToSrcSpan(node), [], nodeToRsExp(state, node.expression), nodeArrayToRsAST(state, node.arguments, nodeToRsExp));
            }

            // Prefix unary expression
            function prefixUnaryExpressionToRsExp(state: RsTranslationState, node: PrefixUnaryExpression): RsExpression {
                switch (node.operator) {
                    case SyntaxKind.MinusToken:
                        return new RsPrefixExpr(nodeToSrcSpan(node), [], new RsPrefixOp(RsPrefixOpKind.PrefixMinus), nodeToRsExp(state, node.operand));
                    case SyntaxKind.TypeOfExpression:
                        return new RsPrefixExpr(nodeToSrcSpan(node), [], new RsPrefixOp(RsPrefixOpKind.PrefixTypeof), nodeToRsExp(state, node.operand));
                    case SyntaxKind.ExclamationToken:
                        return new RsPrefixExpr(nodeToSrcSpan(node), [], new RsPrefixOp(RsPrefixOpKind.PrefixLNot), nodeToRsExp(state, node.operand));
                    case SyntaxKind.PlusPlusToken:
                        return new RsUnaryAssignExpr(nodeToSrcSpan(node), [], new RsUnaryAssignOp(RsUnaryAssignOpKind.PrefixInc), nodeToRsLval(state, node.operand));
                    case SyntaxKind.PlusToken:
                        return new RsPrefixExpr(nodeToSrcSpan(node), [], new RsPrefixOp(RsPrefixOpKind.PrefixPlus), nodeToRsExp(state, node.operand));
                    default:
                        state.error(node, Diagnostics.refscript_Unsupported_prefix_operator_0, SyntaxKind[node.operator]);
                }
            }

            // Postfix unary expression
            function postfixUnaryExpressionToRsExp(state: RsTranslationState, node: PostfixUnaryExpression): RsUnaryAssignExpr {
                switch (node.operator) {
                    case SyntaxKind.PlusPlusToken:
                        return new RsUnaryAssignExpr(nodeToSrcSpan(node), [], new RsUnaryAssignOp(RsUnaryAssignOpKind.PostfixInc), nodeToRsLval(state, node.operand));
                    case SyntaxKind.MinusMinusToken:
                        return new RsUnaryAssignExpr(nodeToSrcSpan(node), [], new RsUnaryAssignOp(RsUnaryAssignOpKind.PostfixDec), nodeToRsLval(state, node.operand));
                    default:
                        state.error(node, Diagnostics.refscript_Unsupported_postfix_operator_0, SyntaxKind[node.operator]);
                }
            }

            // Parenthesized expression
            function parenthesizedExpressionToRsExp(state: RsTranslationState, node: ParenthesizedExpression): RsExpression {
                return nodeToRsExp(state, node.expression);
            }

            // Boolean expression
            function boolKeywordToRsExp(state: RsTranslationState, node: Expression): RsBoolLit {
                return (node.kind === SyntaxKind.TrueKeyword) ? (new RsBoolLit(nodeToSrcSpan(node), [], true)) : (new RsBoolLit(nodeToSrcSpan(node), [], false));
            }

            // Boolean expression
            function functionExpressionToRsExp(state: RsTranslationState, node: FunctionExpression): RsFuncExpr {
                if (node.name) {
                    throw new Error("[refscript] Named function expressions are not supported.");
                }
                let annotations = nodeAnnotations(node, makeFunctionExpressionAnnotations);
                let statements = (node.body.kind === SyntaxKind.Block) ?
                    (<Block>node.body).statements.map(statement => nodeToRsStmt(state, statement)) :                        // Actual body
                    [new RsReturnStmt(nodeToSrcSpan(node), [], new RsJust(nodeToRsExp(state, <Expression>node.body)))];     // Return expression
                return new RsFuncExpr(nodeToSrcSpan(node), annotations, new RsNothing(), nodeArrayToRsAST(state, node.parameters, nodeToRsId), new RsList(statements));
            }

            // typeof expression
            function typeOfExpressionToRsExp(state: RsTranslationState, node: TypeOfExpression): RsPrefixExpr {
                return new RsPrefixExpr(nodeToSrcSpan(node), [], new RsPrefixOp(RsPrefixOpKind.PrefixTypeof), nodeToRsExp(state, node.expression));
            }

            // type assertion expression
            function typeAssertionExpressionToRsExp(state: RsTranslationState, node: TypeAssertion): RsCast {
                let type = checker.getTypeAtLocation(node.type);
                let annotation = new CastAnnotation(nodeToSrcSpan(node.type), checker.typeToString(type, node.type));
                return new RsCast(nodeToSrcSpan(node), [annotation], nodeToRsExp(state, node.expression));
            }

            // conditional expression
            function conditionalExpressionToRsExp(state: RsTranslationState, node: ConditionalExpression): RsCondExpr {
                return new RsCondExpr(nodeToSrcSpan(node), [], nodeToRsExp(state, node.condition), nodeToRsExp(state, node.whenTrue), nodeToRsExp(state, node.whenFalse));
            }

            // object literal expression
            function objectLiteralExpressionToRsExp(state: RsTranslationState, node: ObjectLiteralExpression): RsObjectLit {
                return new RsObjectLit(nodeToSrcSpan(node), [], nodeArrayToRsAST(state, node.properties, nodeToRsAST));
            }

            // Super expression
            function superKeywordToRsExp(state: RsTranslationState, node: Expression): RsSuperRef {
                return new RsSuperRef(nodeToSrcSpan(node), []);
            }

            // this expression
            function thisKeywordToRsExp(state: RsTranslationState, node: Expression): RsThisRef {
                return new RsThisRef(nodeToSrcSpan(node), []);
            }

            // this expression
            function nullKeywordToRsExp(state: RsTranslationState, node: Expression): RsThisRef {
                return new RsNullLit(nodeToSrcSpan(node), []);
            }

            // ExpressionStatement
            function expressionStatementToRsStmt(state: RsTranslationState, node: ExpressionStatement): RsStatement {
                // The annotations will be provided by the contents
                return new RsExprStmt(nodeToSrcSpan(node), [], nodeToRsExp(state, node.expression));
            }

            // BinaryExpression
            function binaryExpressionToRsExp(state: RsTranslationState, node: BinaryExpression): RsExpression {
                switch (node.operatorToken.kind) {
                    case SyntaxKind.PlusToken:
                    case SyntaxKind.GreaterThanToken:
                    case SyntaxKind.GreaterThanEqualsToken:
                    case SyntaxKind.LessThanToken:
                    case SyntaxKind.LessThanEqualsToken:
                    case SyntaxKind.PlusToken:
                    case SyntaxKind.MinusToken:
                    case SyntaxKind.EqualsEqualsEqualsToken:
                    case SyntaxKind.AmpersandAmpersandToken:
                    case SyntaxKind.BarBarToken:
                    case SyntaxKind.AsteriskToken:
                    case SyntaxKind.InstanceOfKeyword:
                        return new RsInfixExpr(nodeToSrcSpan(node), [], new RsInfixOp(getTextOfNode(node.operatorToken)),
                            nodeToRsExp(state, node.left), nodeToRsExp(state, node.right));
                    case SyntaxKind.EqualsToken:
                        return new RsAssignExpr(nodeToSrcSpan(node), [], new RsAssignOp(getTextOfNode(node.operatorToken)), nodeToRsLval(state, node.left), nodeToRsExp(state, node.right));
                    default:
                        state.error(node, Diagnostics.refscript_0_SyntaxKind_1_not_supported_yet, "nodeToRsExp", SyntaxKind[node.kind]);

                }
            }

            function literalExpressionToRsExp(state: RsTranslationState, node: LiteralExpression): RsExpression {
                let nodeText = getTextOfNode(node);
                if (nodeText.indexOf(".") === -1) {
                    if (isHexLit(nodeText)) {
                        return new RsHexLit(nodeToSrcSpan(node), [], nodeText);
                    }
                    else {
                        //No decimal part
                        return new RsIntLit(nodeToSrcSpan(node), [] /*token.getRsAnnotations(AnnotContext.OtherContext)*/, parseInt(nodeText));
                    }
                }
                else {
                    return new RsNumLit(nodeToSrcSpan(node), [] /*token.getRsAnnotations(AnnotContext.OtherContext)*/, parseFloat(nodeText));
                }
            }

            // VariableStatement
            function variableStatementToRsStmt(state: RsTranslationState, variableStatement: VariableStatement): RsStatement {
                if (variableStatement.declarationList.declarations.length !== 1) {
                    throw new Error("[refscript] Currently only supporting one declaration per declaration statement");
                }
                let declaration = variableStatement.declarationList.declarations[0];
                if (declaration.name.kind === SyntaxKind.ObjectBindingPattern || declaration.name.kind === SyntaxKind.ArrayBindingPattern) {
                    throw new Error("[refscript] Object and array binding patterns are not supported.");
                }
                let toName = () => getTextOfNode(<Identifier>declaration.name);
                let toTypeStr = () => checker.typeToString(checker.getTypeAtLocation(declaration), declaration);
                let mkVarDeclAnn = (rawContent: string, srcSpan: RsSrcSpan, node: VariableDeclaration) =>
                    makeVariableDeclarationAnnotation(rawContent, srcSpan, node, toName, toTypeStr);
                let annotations: Annotation[] = nodeAnnotations(variableStatement, mkVarDeclAnn);
                // No type annotation given -- Use the TypeScript one
                if (!annotations.some(a => a instanceof VariableDeclarationAnnotation)) {
                    // PV: not working (why?)
                    // // parse the form: [assgignability] a :: ... -- ignored with over-declaration annotationy
                    // let inlineAssignability = nodeAnnotations(variableStatement.declarationList, makeVariableAssignability)[0];
                    let inlineAssignability = Assignability.WriteLocal;
                    annotations = concatenate(annotations,
                        [new VariableDeclarationAnnotation(nodeToSrcSpan(declaration), inlineAssignability, toName(), toTypeStr())]
                    );
                }
                // Add the 'exported' annotation
                if (variableStatement.modifiers && variableStatement.modifiers.some(modifier => modifier.kind === SyntaxKind.ExportKeyword)) {
                    annotations = concatenate(annotations, [new ExportedAnnotation(nodeToSrcSpan(variableStatement))]);
                }
                let rsVarDecl = new RsVarDecl(nodeToSrcSpan(declaration), annotations, nodeToRsId(state, declaration.name),
                    (declaration.initializer) ? new RsJust(nodeToRsExp(state, declaration.initializer)) : new RsNothing());
                let varDeclList = new RsList([rsVarDecl]);
                // No annotations go to the top-level VariableStatement
                return new RsVarDeclStmt(nodeToSrcSpan(variableStatement), [], varDeclList);
            }

            // object properties
            function propertyAssignmentToRsAST(state: RsTranslationState, node: PropertyAssignment): RsAST {
                return new RsList([new RsPropId(nodeToSrcSpan(node), [], nodeToRsId(state, node.name)), nodeToRsExp(state, node.initializer)]);
            }

            // IfStatement
            function ifStatementToRsStmt(state: RsTranslationState, node: IfStatement): RsStatement {
                if (node.elseStatement) {
                    return new RsIfStmt(nodeToSrcSpan(node), [], nodeToRsExp(state, node.expression), nodeToRsStmt(state, node.thenStatement), nodeToRsStmt(state, node.elseStatement));
                }
                else {
                    return new RsIfSingleStmt(nodeToSrcSpan(node), [], nodeToRsExp(state, node.expression), nodeToRsStmt(state, node.thenStatement));
                }
            }

            // Block statement
            function blockToRsStmt(state: RsTranslationState, node: Block): RsBlockStmt {
                return new RsBlockStmt(nodeToSrcSpan(node), [], nodeArrayToRsAST(state, node.statements, nodeToRsStmt));
            }

            // Return statement
            function returnStatementToRsStmt(state: RsTranslationState, node: ReturnStatement): RsReturnStmt {
                return new RsReturnStmt(nodeToSrcSpan(node), [], (node.expression) ? new RsJust(nodeToRsExp(state, node.expression)) : new RsNothing());
            }

            function typeParametersToString(typeParameters: NodeArray<TypeParameterDeclaration>): string {
                if (typeParameters && typeParameters.length > 0) {
                    return angles(typeParameters.map(typeParameter => {
                        let s = getTextOfNode(typeParameter.name);
                        if (typeParameter.constraint) {
                            s += " extends ";
                            s += checker.typeToString(checker.getTypeAtLocation(typeParameter.constraint), typeParameter.constraint);
                        }
                        return s;
                    }).join(", "));
                }
                return "";
            }

            function heritageClausesToString(heritageClauses: NodeArray<HeritageClause>): string {
                if (heritageClauses && heritageClauses.length > 0) {
                    return concat(heritageClauses.map(heritageClause => {
                        switch (heritageClause.token) {
                            case SyntaxKind.ExtendsKeyword:
                                if (heritageClause.types && heritageClause.types.length > 0) {
                                    // return ["extends", heritageClause.types.map(type => checker.typeToString(checker.getTypeAtLocation(type))).join(", ")];
                                    return [getTextOfNode(heritageClause)];
                                }
                                break;
                            case SyntaxKind.ImplementsKeyword:
                                if (heritageClause.types && heritageClause.types.length > 0) {
                                    // return ["implements", heritageClause.types.map(type => checker.typeToString(checker.getTypeAtLocation(type))).join(", ")];
                                    return [getTextOfNode(heritageClause)];
                                }
                                break;
                        }
                        return [];
                    })).join(" ");
                }
                return "";
            }

            // Interface statement
            function interfaceDeclarationToRsStmt(state: RsTranslationState, node: InterfaceDeclaration): RsInterfaceStmt {

                // TODO: Exported annotation?

                let typeSignatureText: string;
                let headerAnnotations = nodeAnnotations(node, makeTypeSignatureAnnotation);
                if (headerAnnotations && headerAnnotations.length > 0) {
                    typeSignatureText = headerAnnotations[0].content;
                }
                else {
                    let nameText = getTextOfNode(node.name);
                    let typeParametersText = typeParametersToString(node.typeParameters);
                    let heritageText = heritageClausesToString(node.heritageClauses);
                    typeSignatureText = ["interface", nameText, typeParametersText, heritageText].join(" ");
                }

                let bodyText = " { ";
                if (node.members) {
                    bodyText += concat(node.members.map(member => {
                        switch (member.kind) {
                            case SyntaxKind.ConstructSignature:
                                let constructorAnnotations = nodeAnnotations(<ConstructorDeclaration>member, makeConstructorAnnotations);
                                if (constructorAnnotations.length > 0) {
                                    return constructorAnnotations.map(c => c.content);
                                }
                                else {
                                    let constructorSignature = checker.getSignatureFromDeclaration(<ConstructorDeclaration>member);
                                    return ["new " + checker.methodToRscString(constructorSignature, member)];
                                }
                            case SyntaxKind.MethodSignature:
                                let methodAnnotations = nodeAnnotations(<MethodDeclaration>member, makeMethodDeclarationAnnotations);
                                if (methodAnnotations.length > 0) {
                                    return methodAnnotations.map(m => m.content);
                                }
                                else {
                                    let methodSignature = checker.getSignatureFromDeclaration(<MethodDeclaration>member);
                                    return [getTextOfNode(member.name) + checker.methodToRscString(methodSignature, member)];
                                }
                            case SyntaxKind.PropertySignature:
                                let propertyAnnotations = nodeAnnotations(<PropertyDeclaration>member, makePropertyAnnotations);
                                if (propertyAnnotations.length > 0) {
                                    return [propertyAnnotations[0].content];
                                }
                                else {
                                    let propertyType = checker.getTypeAtLocation(member);
                                    let optionText = ((<PropertyDeclaration>member).questionToken) ? "?" : "";
                                    return [getTextOfNode(member.name) + ": " + checker.typeToString(propertyType, member)];
                                }
                            case SyntaxKind.CallSignature:
                                let callAnnotations = nodeAnnotations(<FunctionDeclaration>member, makeCallAnnotations);
                                if (callAnnotations.length > 0) {
                                    return callAnnotations.map(c => c.content);
                                }
                                else {
                                    let callSignature = checker.getSignatureFromDeclaration(<FunctionDeclaration>member);
                                    return [checker.methodToRscString(callSignature, member)];
                                }
                            default:
                                return [];
                        }
                    })).join(";\n")
                }
                bodyText += " }";
                let interfaceAnnotations = makeInterfaceDeclarationAnnotation(typeSignatureText + bodyText, nodeToSrcSpan(node));
                return new RsInterfaceStmt(nodeToSrcSpan(node), interfaceAnnotations, nodeToRsId(state, node.name));
            }

            function typeAliasDeclarationToRsStmt(state: RsTranslationState, node: TypeAliasDeclaration): RsEmptyStmt {
                let annotations = nodeAnnotations(node, makeTypeAliasAnnotations);
                if (annotations.length < 1) {
                    // Define the alias Annotations
                    let annotationText = "type ";
                    annotationText += getTextOfNode(node.name);
                    if (node.typeParameters && node.typeParameters.length > 0) {
                        // TODO: support for constraints
                        annotationText += angles(node.typeParameters.map(a => a.name.text).join(", "));
                    }
                    annotationText += " = ";
                    annotationText += checker.typeToString(checker.getTypeAtLocation(node.type), node);
                    annotations = makeTypeAliasAnnotations(annotationText, nodeToSrcSpan(node));
                }
                return new RsEmptyStmt(nodeToSrcSpan(node), annotations);
            }

            function throwStatementToRsStmt(state: RsTranslationState, node: ThrowStatement): RsThrowStatement {
                return new RsThrowStatement(nodeToSrcSpan(node), [], nodeToRsExp(state, node.expression));
            }

            // class declaration
            function classDeclarationToRsStmt(state: RsTranslationState, node: ClassDeclaration): RsClassStmt {
                let annotations = nodeAnnotations(node, makeClassStatementAnnotations);
                if (annotations.length < 1) {
                    let nameText = getTextOfNode(node.name);
                    let typeParametersText = typeParametersToString(node.typeParameters);
                    let heritageText = heritageClausesToString(node.heritageClauses);
                    let annotationText = ["class", nameText, typeParametersText, heritageText].join(" ");
                    annotations = concatenate(annotations, [new ClassAnnotation(nodeToSrcSpan(node), annotationText)]);
                }

                // Add the 'exported' annotation
                if (node.modifiers && node.modifiers.some(modifier => modifier.kind === SyntaxKind.ExportKeyword)) {
                    annotations = concatenate(annotations, [new ExportedAnnotation(nodeToSrcSpan(node))]);
                }
                return new RsClassStmt(nodeToSrcSpan(node), annotations, nodeToRsId(state, node.name),
                    new RsList(concat(node.members.map(n => nodeToRsClassElts(state, n)))));
            }

            // module declaration
            function moduleDeclarationToRsStmt(state: RsTranslationState, node: ModuleDeclaration): RsModuleStmt {
                let annotations = (node.modifiers && node.modifiers.some(modifier => modifier.kind === SyntaxKind.ExportKeyword)) ?
                    [new ExportedAnnotation(nodeToSrcSpan(node))] : [];

                annotations = concatenate(annotations, [new ModuleAnnotation(nodeToSrcSpan(node), "module " + getTextOfNode(node.name))]);

                if (node.body.kind === SyntaxKind.ModuleBlock) {
                    // A relevant check in checker ensures this is a ModuleBody
                    return new RsModuleStmt(nodeToSrcSpan(node), annotations, nodeToRsId(state, node.name),
                        new RsList((<ModuleBlock>node.body).statements.map(n => nodeToRsStmt(state, n))));
                }

                throw new Error(Diagnostics.refscript_Only_support_ModuleBlocks_inside_a_Module_s_body.key);
            }

            // while statement
            function whileStatementToRsStmt(state: RsTranslationState, node: WhileStatement): RsWhileStmt {
                return new RsWhileStmt(nodeToSrcSpan(node), [], nodeToRsExp(state, node.expression), nodeToRsStmt(state, node.statement));
            }

            // while statement
            function emptyStatementToRsStmt(state: RsTranslationState, node: Statement): RsEmptyStmt {
                return new RsEmptyStmt(nodeToSrcSpan(node), []);
            }

            // constructor declaration
            function constructorDeclarationToRsClassElts(state: RsTranslationState, node: ConstructorDeclaration): RsConstructor[] {
                // Do this only once for the constructor body
                let isAmbient = !!(node.flags & NodeFlags.Ambient);
                if (!node.body && !isAmbient) {
                    // Ignore the overload - it will be included in the function body type
                    return [];
                }

                node.parameters.forEach(parameter => {
                    if (parameter.initializer) {
                        state.error(node, Diagnostics.Initialization_of_parameter_0_at_the_signature_site_is_not_supported, [getTextOfNode(parameter)]);
                    }
                });

                /*
                    PV: There was something weird with getting the actual type signarure
                    from the constructor declaration, so instead we're getting the
                    type from the containing class.
                */
                let containingClass = getContainingClass(node);
                let constructorSignatureInfo = concat(containingClass.members.map(member => {
                    if (member.kind === SyntaxKind.Constructor) {
                        let constructorDeclaration = <ConstructorDeclaration>member;
                        let signature = checker.getSignatureFromDeclaration(constructorDeclaration);
                        return [{
                            ambient: !(constructorDeclaration.body),
                            signature: signature
                        }]
                    }
                    return [];  // skip other cases
                }));

                let constructorSignatures = (constructorSignatureInfo.some(i => i.ambient)) ?
                    (constructorSignatureInfo.filter(i => i.ambient).map(i => i.signature)) :
                    (constructorSignatureInfo.map(i => i.signature));

                let constructorDeclarationAnnotations = concat(constructorSignatures.map(signature => {
                    let signatureDeclaration = signature.declaration;
                    let sourceSpan = nodeToSrcSpan(signatureDeclaration);
                    // these are binder annotations
                    let binderAnnotations = nodeAnnotations(signatureDeclaration, makeConstructorAnnotations);
                    return (binderAnnotations.length === 0) ?
                        [new ConstructorDeclarationAnnotation(sourceSpan, "new " + checker.methodToRscString(signature, signatureDeclaration))] :
                        binderAnnotations;
                }));

                return [new RsConstructor(nodeToSrcSpan(node), constructorDeclarationAnnotations, nodeArrayToRsAST(state, node.parameters, nodeToRsId),
                    nodeArrayToRsAST(state, <NodeArray<Statement>>[] /*node.body.statements */, nodeToRsStmt))];
            }


            // method declaration
            function methodDeclarationToRsClassElts(state: RsTranslationState, node: MethodDeclaration): RsMemberMethDecl[] {
                // Do this only once for the constructor body
                let isAmbient = !!(node.flags & NodeFlags.Ambient);
                if (!node.body && !isAmbient) {
                    // Ignore the overload - it will be included in the function body type
                    return [];
                }

                let nameText = getTextOfNode(node.name);
                let type = checker.getTypeAtLocation(node);
                let signatures = checker.getSignaturesOfType(type, SignatureKind.Call);

                let methodDeclarationAnnotations = concat(signatures.map(signature => {
                    let signatureDeclaration = signature.declaration;
                    let sourceSpan = nodeToSrcSpan(signatureDeclaration);
                    // these are binder annotations
                    let binderAnnotations = nodeAnnotations(signatureDeclaration, makeMethodDeclarationAnnotations);
                    if (binderAnnotations.length === 0) {
                        // No signature annotation on this declaration -> use the one TS infers
                        return [new MethodDeclarationAnnotation(sourceSpan, nameText + checker.methodToRscString(signature, signatureDeclaration))];
                    }
                    else {
                        return binderAnnotations;
                    }
                }));

                let static = !!(node.flags & NodeFlags.Static);

                return [new RsMemberMethDecl(nodeToSrcSpan(node), methodDeclarationAnnotations, static, new RsId(nodeToSrcSpan(node.name), [], nameText),
                    nodeArrayToRsAST(state, node.parameters, nodeToRsId), new RsList(node.body.statements.map(statement => nodeToRsStmt(state, statement))))];
            }

            function propertyDeclarationToRsClassElts(state: RsTranslationState, node: PropertyDeclaration): RsMemberVarDecl[] {
                let nameText = getTextOfNode(node.name);
                let annotations = nodeAnnotations(node, makePropertyAnnotations);
                if (annotations.length === 0) {
                    let type = checker.getTypeAtLocation(node);
                    annotations = concatenate(annotations, [new PropertyAnnotation(nodeToSrcSpan(node), nameText + ": " + checker.typeToString(type, node))]);
                }
                let static = !!(node.flags & NodeFlags.Static);
                return [new RsMemberVarDecl(nodeToSrcSpan(node), annotations, static, new RsId(nodeToSrcSpan(node.name), [], nameText),
                    (node.initializer) ? (new RsJust(nodeToRsExp(state, node.initializer))) : new RsNothing())];
            }


            ///////////////////////////////////////////////////////
            //  Extract Annotations
            ///////////////////////////////////////////////////////

            /**
             * Returns an array of Annotations of type A specified by the type of the creator.
             * The return value is always an array.
             */
            function nodeAnnotations<A>(node: Node, creator: (s: string, srcSpan: RsSrcSpan, node?: Node) => A[]): A[] {
                if (!node)
                    return [];
                let currentSourceFile = getSourceFileOfNode(node);
                let comments = emptyFromUndefined(getLeadingCommentRangesOfNode(node, currentSourceFile));
                let match = comments.map(extractRawContent);

                // if (match && match.filter(t => t !== null).length > 0) {
                //     console.log(match.filter(t => t !== null).map(m => m.cstring));
                // }


                return concat(match.filter(t => t !== null).map(t => creator(t.cstring, t.ss, node)));

                function extractRawContent(commentRange: CommentRange) {
                    let commentText = currentSourceFile.text.substring(commentRange.pos, commentRange.end);
                    let matchStr = commentText.match(/\/\*@([^]*)\*\//g);
                    if (matchStr && matchStr[0]) {
                        let fullStr = matchStr[0];
                        let cstring = fullStr.substring(3, fullStr.length - 2);
                        let beginLineAndChar = getLineAndCharacterOfPosition(currentSourceFile, commentRange.pos);
                        let endLineAndChar = getLineAndCharacterOfPosition(currentSourceFile, commentRange.end)
                        let ss = new RsSrcSpan(currentSourceFile.fileName, beginLineAndChar, endLineAndChar);
                        return { ss, cstring };
                    }
                    return null;
                }
            }

            function isHexLit(s: string): boolean {
                var regexp = new RegExp('0[xX][0-9a-fA-F]+');
                return regexp.test(s);
            }

            function isIntLit(s: string): boolean {
                var regexp = new RegExp('[0-9]+');
                return regexp.test(s);
            }

        }

    }

}
