//<reference path='..\typescript.ts' />
/// <reference path="./initializationStatistics.ts"/>
/// <reference path="./syntax.ts"/>
/// <reference path="./annotations.ts"/>


namespace ts {

    export class RsHelper {

        private _initValidator: InitializationValidator;

        constructor(private _checker: TypeChecker) {
            this._initValidator = new InitializationValidator();
        }

        public ctorValidate() {
            this._initValidator.validate(this._document, this._diagnostics);
        }

        private _document: SourceFile;

        public setDocument(document: SourceFile) {
            this._document = document;
        }

        public clearDiagnostics() {
            this._diagnostics = [];
        }

        private _diagnostics: Diagnostic[] = [];

        // public getDeclForAST(ast: Node): PullDecl {
        //     return this._document._getDeclForAST(ast);
        // }

        public getSymbolForAST(ast: Node): Symbol {
            return this._checker.getSymbolAtLocation(ast);
        }

        public getTypeForAST(ast: Node): Type {
            return this._checker.getTypeAtLocation(ast);
        }

        public isLibrary(ast: Node): boolean {
            return getSourceFileOfNode(ast).text.indexOf("lib.d.ts") === -1;
        }

        public postDiagnostic(ast: Node, diagnosticMsg: DiagnosticMessage, _arguments: any[] = null, additionalLocations: Location[] = null) {
            // var diagnostic = new Diagnostic(ast.fileName(), this._document.lineMap(), ast.start(), ast.width(), diagnosticKey, _arguments, additionalLocations);
            var diagnostic = createDiagnosticForNode(ast, diagnosticMsg, _arguments);
            this._diagnostics.push(diagnostic);
        }

        public diagnostics(): Diagnostic[] {
            return this._diagnostics;
        }

        private _parentNode: Node[] = [];

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

        static mkFixError(diagnostic: Diagnostic): FPError {
            let text1 = diagnostic.messageText;
            let msg = typeof text1 === "string" ? text1 : text1.messageText;
            let file = diagnostic.file;
            let fileName = file.fileName;
            let start = getLineAndCharacterOfPosition(file, diagnostic.start);
            let stop = getLineAndCharacterOfPosition(file, diagnostic.start + dispatchEvent.length);
            return new FPError(msg, new FPSrcSpan(new FPSrcPos(fileName, start.line, start.character), new FPSrcPos(fileName, stop.line, stop.character)));
        }

        public serialize() {
            return {
                "errMsg": this.errMsg,
                "errLoc": this.errLoc.serialize()
            };
        }

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

    export function emitRscJSON(resolver: EmitResolver, host: EmitHost, targetSourceFile: SourceFile): EmitResult {

        let compilerOptions = host.getCompilerOptions();
        let languageVersion = compilerOptions.target || ScriptTarget.ES3;
        let sourceMapDataList: SourceMapData[] = compilerOptions.sourceMap || compilerOptions.inlineSourceMap ? [] : undefined;
        let diagnostics: Diagnostic[] = [];
        let newLine = host.getNewLine();

        if (targetSourceFile === undefined) {
            forEach(host.getSourceFiles(), sourceFile => {
                if (shouldEmitToOwnFile(sourceFile, compilerOptions)) {
                    let jsonFilePath = getOwnEmitOutputFilePath(sourceFile, host, ".json");
                    emitFile(jsonFilePath, sourceFile);
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
            sourceMaps: sourceMapDataList
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
                let helper = new RsHelper(undefined);   // TODO
                let rsAST = nodeToRsAST(helper, node);
                write(JSON.stringify(rsAST.serialize(), undefined, 2));
            }

            function writeRefScriptFile(emitOutput: string, writeByteOrderMark: boolean) {
                writeFile(host, diagnostics, rscFilePath, emitOutput, writeByteOrderMark);
            }

            function nodeToRsAST(helper: RsHelper, node: Node): RsAST {

                switch (node.kind) {
                    case SyntaxKind.SourceFile:
                        return sourceFileNodeToRsAST(helper, <SourceFile>node);
                }

                throw new Error("UNIMPLEMENTED nodeToRsAST for " + SyntaxKind[node.kind]);

            }

            function nodeToRsExp(helper: RsHelper, node: Expression): RsExpression {

                switch (node.kind) {
                    case SyntaxKind.BinaryExpression:
                        return binaryExpressionToRsExp(helper, <BinaryExpression>node);
                    case SyntaxKind.FirstLiteralToken:
                        return literalExpressionToRsExp(helper, <LiteralExpression>node);
                    case SyntaxKind.Identifier:
                        return identifierToRsExp(helper, <Identifier>node);
                }

                throw new Error("UNIMPLEMENTED nodeToRsExp for " + SyntaxKind[node.kind]);
                return undefined;

            }

            function nodeToRsStmt(helper: RsHelper, node: Statement): RsStatement {

                switch (node.kind) {
                    case SyntaxKind.FunctionDeclaration:
                        return functionDeclarationToRsStmt(helper, <FunctionDeclaration>node);
                    case SyntaxKind.ExpressionStatement: helper
                        return expressionStatementToRsStmt(helper, <ExpressionStatement>node);
                    case SyntaxKind.VariableStatement:
                        return variableStatementToRsStmt(helper, <VariableStatement>node);
                }

                throw new Error("UNIMPLEMENTED nodeToRsStmt for " + SyntaxKind[node.kind]);
                return undefined;

            }

            function sourceFileNodeToRsAST(helper: RsHelper, node: SourceFile): RsAST {
                return nodeArrayToRsAST(helper, node.statements, nodeToRsStmt);
            }

            function nodeArrayToRsAST<S extends Node, T extends RsAST>(helper: RsHelper, node: NodeArray<S>, mapper: (helper: RsHelper, node: S) => T): RsList<T> {
                return new RsList(node.map(n => mapper(helper, n)));
            }

            function nodeToRsId(helper: RsHelper, node: Node): RsId {

                switch (node.kind) {
                    case SyntaxKind.Identifier:
                        return new RsId(nodeToSrcSpan(node), /* TODO anns */[], (<Identifier>node).text);
                }
                throw new Error("UNIMPLEMENTED nodeToRsId for " + SyntaxKind[node.kind]);
                return undefined;

            }


            // FunctionDeclaration
            function functionDeclarationToRsStmt(helper: RsHelper, node: FunctionDeclaration): RsStatement {

                //
                // node.callSignature.parameterList.parameters.toNonSeparatorArray().forEach(p => {
                //     if (p.equalsValueClause) {
                //         helper.postDiagnostic(node, DiagnosticCode.Initialization_of_parameter_0_at_the_signature_site_is_not_supported, [p.identifier.text()]);
                //     }
                // });
                //
                // var name = node.identifier.text();
                // var anns = leadingnodeAnnotations(node.firstToken());
                //
                // var declID = PullHelpers.getSignatureForFuncDecl(helper.getDeclForAST(node)).signature.pullSymbolID;
                //
                // var decl: PullDecl = helper.getDeclForAST(node);
                //
                // if (node.modifiers.toArray().some(m => m.tokenKind === SyntaxKind.ExportKeyword)) {
                //     anns.push(new RsAnnotation(node.getSourceSpan(helper), AnnotKind.RawExported, ""));
                // }
                //
                // var bindAnns: RsBindAnnotation[] = <RsBindAnnotation[]> anns.filter(a => a.kind() === AnnotKind.RawBind);
                // var bindAnnNames: string[] = bindAnns.map(a => (<RsBindAnnotation>a).binderName(node, helper));
                //
                // if (bindAnnNames.length === 0) {
                //     // no annotation -- get the TS inferred one
                //     var type = decl.getSignatureSymbol().toRsTFun();
                //     var typeStr = type.toString();
                //     anns.push(new RsBindAnnotation(helper.getSourceSpan(node), AnnotKind.RawBind, Assignability.AErrorAssignability, node.identifier.text() + " :: " + typeStr));
                // }
                // else if (bindAnnNames.length !== 1 || bindAnnNames[0] !== name) {
                //     helper.postDiagnostic(node, DiagnosticCode.Function_0_can_have_at_most_one_type_annotation, [name]);
                // }
                //
                // if (!node.block) {
                //     if (node.modifiers.toArray().some(m => m.tokenKind === SyntaxKind.DeclareKeyword)) {
                //         // Ambient function declaration
                //         return new RsFunctionAmbientDecl(
                //             helper.getSourceSpan(node), anns, node.identifier.toRsId(helper),
                //             <RsList<RsId>>node.callSignature.parameterList.parameters.toRsAST(helper));
                //     }
                //     else {
                //         return new RsFunctionOverload(
                //             helper.getSourceSpan(node), anns, node.identifier.toRsId(helper),
                //             <RsList<RsId>>node.callSignature.parameterList.parameters.toRsAST(helper));
                //     }
                // }
                // else {
                //
                //     // XXX: Disabling node for now
                //
                //
                //     //var funcName = node.identifier.text();
                //     // if (/^[A-Z]/.test(funcName)) {
                //     //	// Constructor Function
                //     //	return new RsFuncCtorStmt(
                //     //		helper.getSourceSpan(node), anns, node.identifier.toRsId(helper),
                //     //		<RsASTList<RsId>>node.callSignature.parameterList.parameters.toRsAST(helper),
                //     //		new RsASTList([node.block.toRsStmt(helper)]));
                //     //}
                //     //else {
                //     // Function definition
                //     return new RsFunctionStmt(
                //         helper.getSourceSpan(node), anns, node.identifier.toRsId(helper),
                //         <RsList<RsId>>node.callSignature.parameterList.parameters.toRsAST(helper),
                //         new RsList([node.block.toRsStmt(helper)]));
                //     //}
                // }

                return undefined;

            }

            // Identifier
            function identifierToRsExp(helper: RsHelper, node: Identifier): RsVarRef {
                return new RsVarRef(nodeToSrcSpan(node), [] /*token.getRsAnnotations(AnnotContext.OtherContext */, nodeToRsId(helper, node));
            }

            // ExpressionStatement
            function expressionStatementToRsStmt(helper: RsHelper, node: ExpressionStatement): RsStatement {
                // The annotations will be provided by the contents
                return new RsExprStmt(nodeToSrcSpan(node), /* nodeAnnotations(this) */[], nodeToRsExp(helper, node.expression));
            }

            // BinaryExpression
            function binaryExpressionToRsExp(helper: RsHelper, node: BinaryExpression): RsExpression {

                // console.log("operator: " + SyntaxKind[node.operatorToken.kind]);

                // leadingNodeAnnotations(node);

                switch (node.operatorToken.kind) {

                    case SyntaxKind.PlusToken:
                        return new RsInfixExpr(nodeToSrcSpan(node), [] /* TODO: leadingNodeAnnotations(node) */,
                            new RsInfixOp(getTextOfNode(node.operatorToken)), nodeToRsExp(helper, node.left), nodeToRsExp(helper, node.right));

                }

                // switch (node.kind) {
                //     case SyntaxKind.PropertyAccessExpression: {
                //         switch (node.right.kind) {
                //             case SyntaxKind.Identifier:
                //                 return new RsDotRef(nodeToSrcSpan(node), leadingNodeAnnotations(node), nodeToRsExp(helper, node.left), nodeToRsAST(helper, <RsId>node.right));
                //         }
                //         //throw new Error("UNIMMPLEMENTED:BinaryExpression:toRsAST:MemberAccessExpression:op2-nonId");
                //         helper.postDiagnostic(node, DiagnosticCode.Cannot_call_toRsAST_on_MemberAccessExpression);
                //     }
                //
                //     case SyntaxKind.AssignmentExpression:
                //         return new RsAssignExpr(
                //             helper.getSourceSpan(node),
                //             leadingNodeAnnotations(node),
                //             new RsAssignOp(node.operatorToken.text()),
                //             node.left.toRsLValue(helper),
                //             node.right.toRsExp(helper));
                //
                //     case SyntaxKind.ElementAccessExpression:
                //         return new RsBracketRef(
                //             helper.getSourceSpan(node),
                //             leadingNodeAnnotations(node),
                //             node.left.toRsExp(helper),
                //             node.right.toRsExp(helper));
                //
                //     case SyntaxKind.AddExpression:
                //     case SyntaxKind.SubtractExpression:
                //     case SyntaxKind.MultiplyExpression:
                //     case SyntaxKind.DivideExpression:
                //     case SyntaxKind.ModuloExpression:
                //     case SyntaxKind.EqualsExpression:
                //     case SyntaxKind.EqualsWithTypeConversionExpression:
                //     case SyntaxKind.GreaterThanExpression:
                //     case SyntaxKind.GreaterThanOrEqualExpression:
                //     case SyntaxKind.LessThanExpression:
                //     case SyntaxKind.LessThanOrEqualExpression:
                //     case SyntaxKind.LogicalOrExpression:
                //     case SyntaxKind.LogicalAndExpression:
                //     case SyntaxKind.NotEqualsWithTypeConversionExpression:
                //     case SyntaxKind.NotEqualsExpression:
                //     case SyntaxKind.LeftShiftExpression:
                //     case SyntaxKind.SignedRightShiftExpression:
                //     case SyntaxKind.UnsignedRightShiftExpression:
                //     case SyntaxKind.BitwiseOrExpression:
                //     case SyntaxKind.BitwiseExclusiveOrExpression:
                //     case SyntaxKind.BitwiseAndExpression:
                //          DONE
                //
                //     case SyntaxKind.AddAssignmentExpression:
                //     case SyntaxKind.SubtractAssignmentExpression:
                //     case SyntaxKind.DivideAssignmentExpression:
                //     case SyntaxKind.MultiplyAssignmentExpression:
                //     case SyntaxKind.LeftShiftAssignmentExpression:
                //     case SyntaxKind.SignedRightShiftAssignmentExpression:
                //     case SyntaxKind.UnsignedRightShiftAssignmentExpression:
                //     case SyntaxKind.AndAssignmentExpression:
                //     case SyntaxKind.ExclusiveOrAssignmentExpression:
                //     case SyntaxKind.OrAssignmentExpression:
                //         return new RsAssignExpr(
                //             helper.getSourceSpan(node),
                //             leadingNodeAnnotations(node),
                //             new RsAssignOp(node.operatorToken.text()),
                //             node.left.toRsLValue(helper),
                //             node.right.toRsExp(helper));
                //
                //     case SyntaxKind.InstanceOfExpression:
                //         return new RsInfixExpr(helper.getSourceSpan(node),
                //             leadingNodeAnnotations(node),
                //             new RsInfixOp("instanceof"),
                //             node.left.toRsExp(helper),
                //             node.right.toRsExp(helper));
                //
                //     case SyntaxKind.InExpression:
                //         return new RsInfixExpr(helper.getSourceSpan(node),
                //             leadingNodeAnnotations(node),
                //             new RsInfixOp("in"),
                //             node.left.toRsExp(helper),
                //             node.right.toRsExp(helper));
                //
                //     default:
                //         //throw new Error("UNIMMPLEMENTED:BinaryExpression:toRsExp:Expression for: " + SyntaxKind[node.kind()]);
                //         helper.postDiagnostic(node,
                //             DiagnosticCode.Cannot_call_toRsExp_on_BinaryExpression_with_SyntaxKind_0,
                //             [SyntaxKind[node.kind()]]);
                // }
            }

            function literalExpressionToRsExp(helper: RsHelper, node: LiteralExpression): RsExpression {

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
            function variableStatementToRsStmt(helper: RsHelper, node: VariableStatement): RsStatement {

                let annotations = leadingNodeAnnotations(node);
                console.log(getTextOfNode(node) + " has " + annotations.length + " annotations");

                let binderAnnotations = <RsBindAnnotation[]>annotations.filter(a => a.kind() === AnnotKind.RawBind);

                if (node.declarationList.declarations.length !== 1) {
                    throw new Error("[refscript] Currently only supporting one declaration per declaration statement");
                }

                let declaration = node.declarationList.declarations[0];
                let modifiers: ModifiersArray = (node.modifiers) ? node.modifiers : <ModifiersArray>[];
                let anns: RsAnnotation[] = concat(modifiers.map(m => leadingNodeAnnotations(m)));

                if (modifiers.some(m => m.kind === SyntaxKind.ExportKeyword)) {
                    anns.push(new RsAnnotation(nodeToSrcSpan(node), AnnotKind.RawExported, ""));
                }
                // Pass over the annotations to the lower levels.
                let varDeclList = new RsList([variableDeclarationToRsVarDecl(helper, declaration, binderAnnotations)]);

                return new RsVarDeclStmt(nodeToSrcSpan(node), [] /* anns */, varDeclList);

            }

            // VariableDeclaration
            function variableDeclarationToRsVarDecl(helper: RsHelper, node: VariableDeclaration, annotations: RsBindAnnotation[]): RsVarDecl {
                // binderAnns: keep just the relevant binder annotations
                if (node.name.kind === SyntaxKind.ObjectBindingPattern || node.name.kind === SyntaxKind.ArrayBindingPattern) {
                    throw new Error("[refscript] Object and array binding patterns are not supported.")
                }
                let idName = <Identifier>node.name;
                let binderAnns = annotations.filter(a => a.binderName(node, helper) === idName.text);

                // TODO: Test ambient declarations
                if ((node.flags & NodeFlags.Ambient) === NodeFlags.Ambient) {
                    // Refscript treats ambient variable declarations as normal declarations.
                    if (binderAnns.length === 0) {
                        let type = typeToRsType(helper.getTypeForAST(node));
                        if (type instanceof TError) {
                            let tError = <TError>type;
                            helper.postDiagnostic(node, Diagnostics.Cannot_translate_type_0_into_RefScript_type, [tError.message()]);
                        }
                        let finalAnnotations = annotations.concat([new RsBindAnnotation(nodeToSrcSpan(node),
                            AnnotKind.RawAmbBind, Assignability.AErrorAssignability, idName.text + " :: " + type.toString())]);
                        return new RsVarDecl(nodeToSrcSpan(node), finalAnnotations, nodeToRsId(helper, idName), new RsNothing());
                    }
                    else if (binderAnns.length === 1) {
                        binderAnns[0]["_kind"] = AnnotKind.RawAmbBind;      // yuk
                        return new RsVarDecl(nodeToSrcSpan(node), binderAnns, nodeToRsId(helper, idName), new RsNothing());
                    }
                    helper.postDiagnostic(this, Diagnostics.Ambient_variable_declarator_for_0_needs_to_have_at_least_one_type_annotation, [idName.text]);
                }

                //This is a normal declaration
                if (binderAnns.length < 2) {
                    //All necessary binders need to be in @anns@
                    return new RsVarDecl(nodeToSrcSpan(node), binderAnns, nodeToRsId(helper, node.name),
                        (node.initializer) ? new RsJust(nodeToRsExp(helper, node.initializer)) : new RsNothing());
                }
                helper.postDiagnostic(this, Diagnostics.Variable_declarator_for_0_needs_to_have_at_most_one_type_annotation, [this.propertyName.text()]);
            }



            ///////////////////////////////////////////////////////
            //  Extract Annotations
            ///////////////////////////////////////////////////////

            function leadingNodeAnnotations(node: Node, context?: AnnotContext): RsAnnotation[] {
                return nodeAnnotations(node, true, context);
            }

            function trailingNodeAnnotations(node: Node, context?: AnnotContext): RsAnnotation[] {
                return nodeAnnotations(node, false, context);
            }

            function nodeAnnotations(node: Node, lead: boolean, context?: AnnotContext): RsAnnotation[] {
                if (!node) return [];
                let ctx = (context !== undefined) ? context : AnnotContext.OtherContext;
                let currentSourceFile = getSourceFileOfNode(node);
                let comments = getLeadingCommentRangesOfNode(node, currentSourceFile);
                let match = comments.map(extractBinderAndAnnotation);
                return match.filter(t => t !== null).map(t => RsAnnotation.createAnnotation(t.snd(), ctx, t.fst()));

                function extractBinderAndAnnotation(commentRange: CommentRange) {
                    let commentText = currentSourceFile.text.substring(commentRange.pos, commentRange.end);
                    let matchStr = commentText.match(/\/\*@([^]*)\*\//g);
                    if (matchStr && matchStr[0]) {
                        let fullStr = matchStr[0];
                        let cstring = fullStr.substring(3, fullStr.length - 2);
                        let beginLineAndChar = getLineAndCharacterOfPosition(currentSourceFile, commentRange.pos);
                        let endLineAndChar = getLineAndCharacterOfPosition(currentSourceFile, commentRange.end)
                        let ss = new RsSrcSpan(currentSourceFile.fileName, beginLineAndChar, endLineAndChar);
                        return new Pair(ss, cstring);
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


            ///////////////////////////////////////////////////////
            //  Type Translation
            ///////////////////////////////////////////////////////

            function typeToRsType(type: Type): RsType {
                // TODO

                return undefined;
            }

        }

    }

}
