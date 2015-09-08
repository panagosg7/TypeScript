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

        public getParentNode(): Node {
            if (this._parentNode && this._parentNode.length > 0) {
                return this._parentNode[this._parentNode.length - 1];
            }
            return null;
        }

        public pushParentNode(p: Node) {
            if (!this._parentNode) {
                this._parentNode = [];
            }
            this._parentNode.push(p);
        }

        public popParentNode(): Node {
            if (this._parentNode && this._parentNode.length > 0) {
                this._parentNode.pop();
            }
            return null;
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
        let stop = getLineAndCharacterOfPosition(file, diagnostic.start + dispatchEvent.length);
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
            return { "UnknownError": this.msg };
        }
    }

    // FIXRESULT
    //
    // [{"Safe":[]},
    //  {"Crash":[[],"stack"]},
    //  {"Unsafe":[{"errMsg":"AAA",
    //              "errLoc":
    //                { "sp_start":{"line":1,"column":1},
    //                  "sp_stop" :{"line":1,"column":1}
    //                }
    //             },
    //             {"errMsg":"BBB","errLoc":{"sp_start":{"line":1,"column":1},"sp_stop":{"line":1,"column":1}}}]},
    //  {"UnknownError":"Unkowntext"}]


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
                if (shouldEmitToOwnFile(sourceFile, compilerOptions)) {
                    let jsonFilePath = getNormalizedAbsolutePath(getOwnEmitOutputFilePath(sourceFile, host, ".json"), host.getCurrentDirectory());
                    emitFile(jsonFilePath, sourceFile);
                    return jsonFilePath;
                }
            });

            if (compilerOptions.outFile || compilerOptions.out) {
                emitFile(compilerOptions.outFile || compilerOptions.out);
            }
        }
        else {
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
                }

                throw new Error("UNIMPLEMENTED nodeToRsAST for " + SyntaxKind[node.kind]);
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
                }

                throw new Error("UNIMPLEMENTED nodeToRsExp for " + SyntaxKind[node.kind]);
                return undefined;
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
                }

                throw new Error("UNIMPLEMENTED nodeToRsStmt for " + SyntaxKind[node.kind]);
                return undefined;
            }

            function sourceFileNodeToRsAST(state: RsTranslationState, node: SourceFile): RsAST {
                return nodeArrayToRsAST(state, node.statements, nodeToRsStmt);
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

                throw new Error("UNIMPLEMENTED nodeToRsId for " + SyntaxKind[node.kind]);
                return undefined;
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

                // Add the 'exported' annotation
                // TODO
                // if (node.modifiers && node.modifiers.some(modifier => modifier.kind === SyntaxKind.ExportKeyword)) {
                //     annotations = annotations.concat(new ExportedAnnotation(nodeToSrcSpan(node)));
                // }

                let type = checker.getTypeAtLocation(node);
                let signatures = checker.getSignaturesOfType(type, SignatureKind.Call);

                let functionDeclarationAnnotations = concat(signatures.map(signature => {
                    // console.log("SIG: " + checker.signatureToRscString(signature))
                    let signatureDeclaration = signature.declaration;
                    let sourceSpan = nodeToSrcSpan(signatureDeclaration);
                    // these are binder annotations
                    let binderAnnotations = nodeAnnotations(signatureDeclaration, makeFunctionDeclarationAnnotation);
                    if (binderAnnotations.length === 0) {
                        // No signature annotation on this declaration -> use the one TS infers
                        // return signatureToRsTFun(signature).map(functionType => new FunctionDeclarationAnnotation(sourceSpan, functionType.toString()));
                        return [new FunctionDeclarationAnnotation(sourceSpan, nameText + " :: " + checker.signatureToRscString(signature, signatureDeclaration))];
                    }
                    else {
                        // console.log("    Binder found: " + binderAnnotations[0].getContent());
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

            // Stirng literal
            function stringLiteralToRsExp(state: RsTranslationState, node: StringLiteral): RsStringLit {
                return new RsStringLit(nodeToSrcSpan(node), [], node.text);
            }

            // ExpressionStatement
            function expressionStatementToRsStmt(state: RsTranslationState, node: ExpressionStatement): RsStatement {
                // The annotations will be provided by the contents
                return new RsExprStmt(nodeToSrcSpan(node), [], nodeToRsExp(state, node.expression));
            }

            // BinaryExpression
            function binaryExpressionToRsExp(state: RsTranslationState, node: BinaryExpression): RsExpression {
                // console.log("operator: " + SyntaxKind[node.operatorToken.kind]);
                switch (node.operatorToken.kind) {
                    case SyntaxKind.PlusToken:
                    case SyntaxKind.GreaterThanToken:
                    case SyntaxKind.GreaterThanEqualsToken:
                    case SyntaxKind.LessThanToken:
                    case SyntaxKind.LessThanEqualsToken:
                    case SyntaxKind.PlusToken:
                    case SyntaxKind.MinusToken:
                        return new RsInfixExpr(nodeToSrcSpan(node), [], new RsInfixOp(getTextOfNode(node.operatorToken)),
                            nodeToRsExp(state, node.left), nodeToRsExp(state, node.right));
                    default:
                        throw new Error("[refscript] BinaryExpression toRsExp Expression for: " + SyntaxKind[node.operatorToken.kind]);
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

                let annotations: Annotation[] = nodeAnnotations(node, makeVariableDeclarationAnnotation);
                let modifiers: ModifiersArray = (node.modifiers) ? node.modifiers : <ModifiersArray>[];

                // Export (export var ... )
                // TODO
                // if (modifiers.some(modifier => modifier.kind === SyntaxKind.ExportKeyword)) {
                //     annotations = annotations.concat(new ExportedAnnotation(nodeToSrcSpan(node)));
                // }
                // Ambient (declare var ... )
                // TODO
                // if ((node.flags & NodeFlags.Ambient) === NodeFlags.Ambient) {
                //     // TODO: test this check
                //     annotations = annotations.concat(new AmbientAnnotation(nodeToSrcSpan(node)));
                // }
                // Pass over the annotations to the lower levels.
                let varDeclList = new RsList([variableDeclarationToRsVarDecl(state, declaration, annotations)]);

                // No annotations go to the top-level VariableStatement
                return new RsVarDeclStmt(nodeToSrcSpan(node), [], varDeclList);
            }

            // VariableDeclaration
            function variableDeclarationToRsVarDecl(state: RsTranslationState, node: VariableDeclaration, annotations: Annotation[]): RsVarDecl {

                if (node.name.kind === SyntaxKind.ObjectBindingPattern || node.name.kind === SyntaxKind.ArrayBindingPattern)
                    throw new Error("[refscript] Object and array binding patterns are not supported.");

                let idName = <Identifier>node.name;

                if (!annotations.some(a => a instanceof VariableDeclarationAnnotation)) {
                    // No type annotation given -- Use the TypeScript one
                    let type = checker.getTypeAtLocation(node);
                    // if (type instanceof TError) {
                    //     state.postDiagnostic(node, Diagnostics.Cannot_translate_type_0_into_RefScript_type, [type.message()]);
                    // }
                    annotations = annotations.concat(
                        [new VariableDeclarationAnnotation(nodeToSrcSpan(node), Assignability.WriteGlobal, idName.text + " :: " + checker.typeToRscString(type, node))]);
                }
                return new RsVarDecl(nodeToSrcSpan(node), annotations, nodeToRsId(state, node.name),
                    (node.initializer) ? new RsJust(nodeToRsExp(state, node.initializer)) : new RsNothing());
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

            // Interface statement
            function interfaceDeclarationToRsStmt(state: RsTranslationState, node: InterfaceDeclaration): RsInterfaceStmt {

                // TODO: Exported annotation?

                let typeSignatureText = "";
                let headerAnnotations = nodeAnnotations(node, makeTypeSignatureAnnotation);
                if (headerAnnotations && headerAnnotations.length > 0) {
                    typeSignatureText += headerAnnotations[0].content;
                }
                else {

                    let interfaceHeaderText = "interface ";
                    interfaceHeaderText += getTextOfNode(node.name);
                    if (node.typeParameters) {
                        interfaceHeaderText += angles(node.typeParameters.map(typeParameter => getTextOfNode(typeParameter)).join(", "));
                    }
                    if (node.heritageClauses) {
                        interfaceHeaderText += " " + node.heritageClauses.map(heritageClause => getTextOfNode(heritageClause)).join(", ");
                    }
                    typeSignatureText += interfaceHeaderText;
                }

                let bodyText = " { ";
                if (node.members) {
                    bodyText += concat(node.members.map(member => {
                        switch (member.kind) {
                            case SyntaxKind.ConstructSignature:
                                let constructorAnnotations = nodeAnnotations(<ConstructorDeclaration>member, makeConstructorAnnotations);
                                if (constructorAnnotations.length > 0) {
                                    return [constructorAnnotations[0].getContent()];
                                }
                                else {
                                    let constructorSignature = checker.getSignatureFromDeclaration(<ConstructorDeclaration>member);
                                    return ["new " + checker.signatureToRscString(constructorSignature, member)];
                                }
                            case SyntaxKind.MethodSignature:
                                let methodAnnotations = nodeAnnotations(<MethodDeclaration>member, makeMethodAnnotations);
                                if (methodAnnotations.length > 0) {
                                    return [methodAnnotations[0].getContent()];
                                }
                                else {
                                    let methodSignature = checker.getSignatureFromDeclaration(<MethodDeclaration>member);
                                    return [getTextOfNode(member.name) + checker.signatureToRscString(methodSignature, member)];
                                }
                            case SyntaxKind.PropertySignature:
                                let propertyAnnotations = nodeAnnotations(<PropertyDeclaration>member, makePropertyAnnotations);
                                if (propertyAnnotations.length > 0) {
                                    return [propertyAnnotations[0].getContent()];
                                }
                                else {
                                    let propertyType = checker.getTypeAtLocation(member);
                                    let optionText = ((<PropertyDeclaration>member).questionToken) ? "?" : "";
                                    return [getTextOfNode(member.name) +  ": " + checker.typeToRscString(propertyType, member)];
                                }
                            case SyntaxKind.CallSignature:
                                let callAnnotations = nodeAnnotations(<FunctionDeclaration>member, makeCallAnnotations);
                                if (callAnnotations.length > 0) {
                                    return [callAnnotations[0].getContent()];
                                }
                                else {
                                    let callSignature = checker.getSignatureFromDeclaration(<FunctionDeclaration>member);
                                    return [checker.signatureToRscString(callSignature, member)];
                                }
                            case SyntaxKind.IndexSignature:


                            default:
                                // console.log(SyntaxKind[member.kind]);
                                return [];
                        }
                    })).join(";\n")
                }
                bodyText += " }";
                let interfaceAnnotations = makeInterfaceDeclarationAnnotation(typeSignatureText + bodyText, nodeToSrcSpan(node));
                return new RsInterfaceStmt(nodeToSrcSpan(node), interfaceAnnotations, nodeToRsId(state, node.name));
            }

            function typeAliasDeclarationToRsStmt(state: RsTranslationState, node: TypeAliasDeclaration): RsEmptyStmt {
                let annotations = nodeAnnotations(node, makeTypeAliasAnnotation);
                if (!annotations || annotations.length < 1) {
                    // Define the alias Annotations
                    let annotationText = getTextOfNode(node.name);
                    annotationText += " = ";
                    annotationText += checker.typeToRscString(checker.getTypeAtLocation(node.type), node);
                    annotations = annotations.concat(makeTypeAliasAnnotation(annotationText, nodeToSrcSpan(node)));
                }
                return new RsEmptyStmt(nodeToSrcSpan(node), annotations);
            }


            ///////////////////////////////////////////////////////
            //  Extract Annotations
            ///////////////////////////////////////////////////////

            /**
             * [node description]
             * @type {Node}
             */
            function nodeAnnotations<A extends Annotation>(node: Node, creator: (s: string, srcSpan: RsSrcSpan) => A[]): A[] {

                if (!node) return [];

                let currentSourceFile = getSourceFileOfNode(node);
                let comments = emptyFromUndefined(getLeadingCommentRangesOfNode(node, currentSourceFile));
                let match = comments.map(extractBinderAndAnnotation);

                return concat(match.filter(t => t !== null).map(t => creator(t.cstring, t.ss)));

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
