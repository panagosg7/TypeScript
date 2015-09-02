//<reference path='..\typescript.ts' />
/// <reference path="./initializationStatistics.ts"/>


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

        // public getSymbolForDecl(decl: PullDecl): PullSymbol {
        //     return this._checker.getSymbolForDecl(decl);
        // }

        public getSourceSpan(ast: Node): RsSrcSpan {
            let file = getSourceFileOfNode(ast);
            let start = getLineAndCharacterOfPosition(file, ast.pos);
            let stop = getLineAndCharacterOfPosition(file, ast.pos);
            return new RsSrcSpan(file.fileName, start, stop);
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


    function rsSrcSpanOfNode(node: Node) {
        let file = getSourceFileOfNode(node);
        let start = getLineAndCharacterOfPosition(file, node.pos);
        let stop = getLineAndCharacterOfPosition(file, node.end);
        return new RsSrcSpan(file.fileName, start, stop);
    }

    export function emitRscJSON(resolver: EmitResolver, host: EmitHost, targetSourceFile: SourceFile): EmitResult {

        console.log("In emitRscJSON");

        let compilerOptions = host.getCompilerOptions();
        let languageVersion = compilerOptions.target || ScriptTarget.ES3;
        let sourceMapDataList: SourceMapData[] = compilerOptions.sourceMap || compilerOptions.inlineSourceMap ? [] : undefined;
        let diagnostics: Diagnostic[] = [];
        let newLine = host.getNewLine();
        let jsxDesugaring = host.getCompilerOptions().jsx !== JsxEmit.Preserve;
        let shouldEmitJsx = (s: SourceFile) => (s.languageVariant === LanguageVariant.JSX && !jsxDesugaring);

        if (targetSourceFile === undefined) {
            forEach(host.getSourceFiles(), sourceFile => {
                if (shouldEmitToOwnFile(sourceFile, compilerOptions)) {
                    let jsFilePath = getOwnEmitOutputFilePath(sourceFile, host, shouldEmitJsx(sourceFile) ? ".jsx" : ".js");
                    emitFile(jsFilePath, sourceFile);
                }
            });

            if (compilerOptions.outFile || compilerOptions.out) {
                emitFile(compilerOptions.outFile || compilerOptions.out);
            }
        }
        else {
            // targetSourceFile is specified (e.g calling emitter from language service or calling getSemanticDiagnostic from language service)
            if (shouldEmitToOwnFile(targetSourceFile, compilerOptions)) {
                let jsFilePath = getOwnEmitOutputFilePath(targetSourceFile, host, shouldEmitJsx(targetSourceFile) ? ".jsx" : ".js");
                emitFile(jsFilePath, targetSourceFile);
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
                // TODO
                console.log("In emitRefScriptWorker");

            }


            function writeRefScriptFile(emitOutput: string, writeByteOrderMark: boolean) {
                writeFile(host, diagnostics, rscFilePath, emitOutput, writeByteOrderMark);
            }

        }



    }

}
