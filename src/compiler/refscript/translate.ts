//<reference path='..\typescript.ts' />
/// <reference path="./initializationStatistics.ts"/>
/// <reference path="./syntax.ts"/>
/// <reference path="./annotations.ts"/>
/// <reference path="./types.ts"/>
/// <reference path="../../../ext/json-stringify-pretty-compact/index.ts"/>

namespace ts {

    export class RsTranslationState {

        private _initValidator = new InitializationValidator();
        private _parentNode: Node[] = [];
        private _document: SourceFile;

        public ctorValidate() {
            this._initValidator.validate(this._document, this._diagnostics);
        }

        public setDocument(document: SourceFile) {
            this._document = document;
        }

        public clearDiagnostics() {
            this._diagnostics = [];
        }

        private _diagnostics: Diagnostic[] = [];

        public isLibrary(ast: Node): boolean {
            return getSourceFileOfNode(ast).text.indexOf("lib.d.ts") === -1;
        }

        public postDiagnostic(ast: Node, diagnosticMsg: DiagnosticMessage, _arguments: any[] = null, additionalLocations: Location[] = null) {
            let diagnostic = createDiagnosticForNode(ast, diagnosticMsg, _arguments);
            this._diagnostics.push(diagnostic);
        }

        public diagnostics(): Diagnostic[] {
            return this._diagnostics;
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
        let fileName = file.fileName;
        let start = getLineAndCharacterOfPosition(file, diagnostic.start);
        let stop = getLineAndCharacterOfPosition(file, diagnostic.start + diagnostic.length);
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

        // In RSC only the first case should ever be called.
        if (targetSourceFile === undefined) {
            jsonFiles = map(host.getSourceFiles(), sourceFile => {
                let jsonFilePath = getNormalizedAbsolutePath(getOwnEmitOutputFilePath(sourceFile, host, ".json"), host.getCurrentDirectory());
                emitFile(jsonFilePath, sourceFile);
                return jsonFilePath;
            });

            if (compilerOptions.outFile || compilerOptions.out) {
                emitFile(compilerOptions.outFile || compilerOptions.out);
            }
        }
        else {
            // RSC: this is not supposed to be triggered
            // targetSourceFile is specified (e.g calling emitter from language service or calling getSemanticDiagnostic from language service)
            if (shouldEmitToOwnFile(targetSourceFile, compilerOptions)) {
                let jsonFilePath = getOwnEmitOutputFilePath(targetSourceFile, host, ".json");
                emitFile(jsonFilePath, targetSourceFile);
            }
            else if (!isDeclarationFile(targetSourceFile) && (compilerOptions.outFile || compilerOptions.out)) {
                emitFile(compilerOptions.outFile || compilerOptions.out);
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

        function emitFile(rscFilePath: string, sourceFile?: SourceFile) {
            emitRefScript(rscFilePath, sourceFile);

            // TODO
            // if (compilerOptions.declaration) {
            //     writeDeclarationFile(rscFilePath, sourceFile, host, resolver, diagnostics);
            // }
        }

        function emitRefScript(rscFilePath: string, root?: SourceFile) {
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

            if (root) {
                // Do not call emit directly. It does not set the currentSourceFile.
                emitSourceFile(root);
            }
            else {
                forEach(host.getSourceFiles(), sourceFile => {
                    if (!isExternalModuleOrDeclarationFile(sourceFile)) {
                        emitSourceFile(sourceFile);
                    }
                });
            }

            writeLine();
            writeEmittedFiles(writer.getText(), /*writeByteOrderMark*/ compilerOptions.emitBOM);
            return;

            function emitSourceFile(sourceFile: SourceFile): void {
                currentSourceFile = sourceFile;
                exportFunctionForFile = undefined;
                emit(sourceFile);
            }

            function emitRefScriptWorker(node: Node) {
                let state = new RsTranslationState();
                let rsAST = nodeToRsAST(state, node);
                write(PrettyJSON.stringify(rsAST.serialize(), { maxLength: 120, indent: 2 }));
            }

            function writeRefScriptFile(emitOutput: string, writeByteOrderMark: boolean) {
                writeFile(host, diagnostics, rscFilePath, emitOutput, writeByteOrderMark);
            }

            function nodeToRsAST(state: RsTranslationState, node: Node): RsAST {
                switch (node.kind) {
                    case SyntaxKind.SourceFile:
                        return sourceFileNodeToRsAST(state, <SourceFile>node);
                    case SyntaxKind.PropertyAssignment:
                        return propertyAssignmentToRsAST(state, <PropertyAssignment>node);
                }
                throw new Error("UNIMPLEMENTED nodeToRsAST for " + node.kind);
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
                }
                throw new Error("UNIMPLEMENTED nodeToRsExp for " + node.kind);
            }

            function nodeToRsLval(state: RsTranslationState, node: Expression): RsLValue {
                switch (node.kind) {
                    case SyntaxKind.Identifier:
                        return new RsLVar(nodeToSrcSpan(node), [], (<Identifier>node).text);
                    case SyntaxKind.PropertyAccessExpression:
                        return propertyAccessExpressionToRsLVal(state, <PropertyAccessExpression>node);
                }
                throw new Error("[refscript] Unimplemented nodeToRsLval for " + node.kind);
            }

            function nodeToRsStmt(state: RsTranslationState, node: Statement): RsStatement {
                switch (node.kind) {
                    case SyntaxKind.FunctionDeclaration:
                        return functionDeclarationToRsStmt(state, <FunctionDeclaration>node);
                    case SyntaxKind.ExpressionStatement: state
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
                }

                throw new Error("[refscript] Unimplemented nodeToRsStmt for " + node.kind);
            }
            
            function nodeToRsClassElts(state: RsTranslationState, node: ClassElement): RsClassElt[] {
                switch (node.kind) {
                    case SyntaxKind.Constructor:
                        return constructorDeclarationToRsClassElts(state, <ConstructorDeclaration>node);
                
                }
                throw new Error("[refscript] Unimplemented nodeToRsClassElts for " + node.kind);
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

            function nodeToRsId(state: RsTranslationState, node: Node): RsId {
                switch (node.kind) {
                    case SyntaxKind.Identifier:
                        return new RsId(nodeToSrcSpan(node), [], (<Identifier>node).text);
                    case SyntaxKind.Parameter:
                        return new RsId(nodeToSrcSpan(node), [], getTextOfNode((<ParameterDeclaration>node).name));
                }

                throw new Error("UNIMPLEMENTED nodeToRsId for " + node.kind);
            }

            // FunctionDeclaration
            function functionDeclarationToRsStmt(state: RsTranslationState, node: FunctionDeclaration): RsStatement {
                let isAmbient = !!(node.flags & NodeFlags.Ambient);
                if (!node.body && !isAmbient) {
                    // Ignore the overload - it will be included in the function body type
                    return new RsEmptyStmt(nodeToSrcSpan(node), []);
                }

                node.parameters.forEach(parameter => {
                    if (parameter.initializer) {
                        state.postDiagnostic(node, Diagnostics.Initialization_of_parameter_0_at_the_signature_site_is_not_supported, [getTextOfNode(parameter)]);
                    }
                });

                let nameText = node.name.text;
                let annotations: Annotation[] = []

                // Add the 'exported' annotation -- exported function are assumed to be top-level (are not K-vared)
                if (node.modifiers && node.modifiers.some(modifier => modifier.kind === SyntaxKind.ExportKeyword)) {
                    annotations = concatenate(annotations, [new ExportedAnnotation(nodeToSrcSpan(node))]);
                }

                let type = checker.getTypeAtLocation(node);
                let signatures = checker.getSignaturesOfType(type, SignatureKind.Call);

                let functionDeclarationAnnotations = concat(signatures.map(signature => {
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

            // Stirng literal
            function stringLiteralToRsExp(state: RsTranslationState, node: StringLiteral): RsStringLit {
                return new RsStringLit(nodeToSrcSpan(node), [], node.text);
            }

            // New expression
            function newExpressionToRsExp(state: RsTranslationState, node: NewExpression): RsNewExpr {
                return new RsNewExpr(nodeToSrcSpan(node), [], nodeToRsExp(state, node.expression), nodeArrayToRsAST(state, node.arguments, nodeToRsExp));
            }

            // Prefix unary expression
            function prefixUnaryExpressionToRsExp(state: RsTranslationState, node: PrefixUnaryExpression): RsPrefixExpr {
                return new RsPrefixExpr(nodeToSrcSpan(node), [], new RsPrefixOp(node.operator), nodeToRsExp(state, node.operand));
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
                return new RsPrefixExpr(nodeToSrcSpan(node), [], new RsPrefixOp(node.kind), nodeToRsExp(state, node.expression));
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
                        throw new Error("[refscript] BinaryExpression toRsExp Expression for: " + node.operatorToken.kind);
                }
            }

            function literalExpressionToRsExp(state: RsTranslationState, node: LiteralExpression): RsExpression {
                let nodeText = getTextOfNode(node);
                if (nodeText.indexOf(".") === -1) {
                    //console.log(token.text() + " kind: " + SyntaxKind[token.kind()] + "  ISHEX? " + isHexLit(token.text()));
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
            function variableStatementToRsStmt(state: RsTranslationState, node: VariableStatement): RsStatement {
                if (node.declarationList.declarations.length !== 1)
                    throw new Error("[refscript] Currently only supporting one declaration per declaration statement");

                let declaration = node.declarationList.declarations[0];
                let annotations = nodeAnnotations(node, makeVariableDeclarationAnnotation);

                // Add the 'exported' annotation
                if (node.modifiers && node.modifiers.some(modifier => modifier.kind === SyntaxKind.ExportKeyword)) {
                    annotations = concatenate(annotations, [new ExportedAnnotation(nodeToSrcSpan(node))]);
                }

                // Pass over the annotations to the lower levels.
                let varDeclList = new RsList([variableDeclarationToRsVarDecl(state, declaration, annotations)]);

                // No annotations go to the top-level VariableStatement
                return new RsVarDeclStmt(nodeToSrcSpan(node), [], varDeclList);
            }

            // VariableDeclaration
            function variableDeclarationToRsVarDecl(state: RsTranslationState, node: VariableDeclaration, annotations: Annotation[]): RsVarDecl {
                if (node.name.kind === SyntaxKind.ObjectBindingPattern || node.name.kind === SyntaxKind.ArrayBindingPattern)
                    throw new Error("[refscript] Object and array binding patterns are not supported.");

                if ((!annotations.some(a => a instanceof VariableDeclarationAnnotation)) && isInAmbientContext(node)) {
                    // No type annotation given -- Use the TypeScript one
                    let idName = <Identifier>node.name;
                    let type = checker.typeToString(checker.getTypeAtLocation(node), node);
                    annotations = annotations.concat(makeVariableDeclarationAnnotation([idName.text, "::", type].join(" "), nodeToSrcSpan(node), node));
                }

                return new RsVarDecl(nodeToSrcSpan(node), annotations, nodeToRsId(state, node.name),
                    (node.initializer) ? new RsJust(nodeToRsExp(state, node.initializer)) : new RsNothing());
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
                                    return ["extends", heritageClause.types.map(type => checker.typeToString(checker.getTypeAtLocation(type))).join(", ")];
                                }
                                break;                            
                            case SyntaxKind.ImplementsKeyword:
                                if (heritageClause.types && heritageClause.types.length > 0) {
                                    return ["implements", heritageClause.types.map(type => checker.typeToString(checker.getTypeAtLocation(type))).join(", ")];
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
                                    return [constructorAnnotations[0].content];
                                }
                                else {
                                    let constructorSignature = checker.getSignatureFromDeclaration(<ConstructorDeclaration>member);
                                    return ["new " + checker.methodToRscString(constructorSignature, member)];
                                }
                            case SyntaxKind.MethodSignature:
                                let methodAnnotations = nodeAnnotations(<MethodDeclaration>member, makeMethodAnnotations);
                                if (methodAnnotations.length > 0) {
                                    return [methodAnnotations[0].content];
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
                                    return [callAnnotations[0].content];
                                }
                                else {
                                    let callSignature = checker.getSignatureFromDeclaration(<FunctionDeclaration>member);
                                    return [checker.methodToRscString(callSignature, member)];
                                }
                            case SyntaxKind.IndexSignature:
                                // TODO 
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
                        state.postDiagnostic(node, Diagnostics.Initialization_of_parameter_0_at_the_signature_site_is_not_supported, [getTextOfNode(parameter)]);
                    }
                });
                            
                let containingClass = getContainingClass(node);
                let constructorSignatureInfo = containingClass.members.map(member => {
                    if (member.kind === SyntaxKind.Constructor) {
                        let constructorDeclaration = <ConstructorDeclaration>member;
                        let signature = checker.getSignatureFromDeclaration(constructorDeclaration);
                        return {
                            ambient: !(constructorDeclaration.body),
                            signature: signature
                        }
                    }                                       
                });
                
                let constructorSignatures = (constructorSignatureInfo.some(i => i.ambient))?
                    (constructorSignatureInfo.filter(i => i.ambient).map(i => i.signature)):
                    (constructorSignatureInfo.map(i => i.signature));                

                let constructorDeclarationAnnotations = concat(constructorSignatures.map(signature => {
                    let signatureDeclaration = signature.declaration;
                    let sourceSpan = nodeToSrcSpan(signatureDeclaration);
                    // these are binder annotations
                    let binderAnnotations = nodeAnnotations(signatureDeclaration, makeConstructorAnnotations);
                    return (binderAnnotations.length === 0) ?
                        [new ConstructorDeclarationAnnotation(sourceSpan, "constructor :: " + checker.methodToRscString(signature, signatureDeclaration))] :
                        binderAnnotations;                    
                }));
                
                return [new RsConstructor(nodeToSrcSpan(node), constructorDeclarationAnnotations, nodeArrayToRsAST(state, node.parameters, nodeToRsId), 
                    nodeArrayToRsAST(state, <NodeArray<Statement>>[] /*node.body.statements */, nodeToRsStmt))];
            }


            ///////////////////////////////////////////////////////
            //  Extract Annotations
            ///////////////////////////////////////////////////////

            /**
             * Returns an array of Annotations of type A specified by the type of the creator.
             * The return value is always an array.
             */
            function nodeAnnotations<A extends Annotation>(node: Node, creator: (s: string, srcSpan: RsSrcSpan, node?: Node) => A[]): A[] {

                if (!node) return [];

                let currentSourceFile = getSourceFileOfNode(node);
                let comments = emptyFromUndefined(getLeadingCommentRangesOfNode(node, currentSourceFile));
                let match = comments.map(extractBinderAndAnnotation);

                return concat(match.filter(t => t !== null).map(t => creator(t.cstring, t.ss, node)));

                function extractBinderAndAnnotation(commentRange: CommentRange) {
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
