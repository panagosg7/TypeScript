//<reference path='..\typescript.ts' />

//TODO (known bug): doesn't handle e.g. interface I { field: () => number; }
module ts {

    // class OverloadState {
    //     constructor(public semanticInfoChain: SemanticInfoChain,
    //         public funcs = new Map(),
    //         public overloadFuncs = 0,
    //         public optargedFuncs = 0,
    //         public overloadedIntersectOptargedFuncs = 0,
    //         public totalFuncs = 0) { }
    // }
    //
    // // based on d3's map
    // class Map {
    //     private s: { [name: string]: PullTypeSymbol[] };
    //     private static PREFIX = "\0"; // prevent collision with built-ins
    //     constructor() { this.s = {}; }
    //     get(key: string) { return this.s[Map.PREFIX + key]; }
    //     set(key: string, value: any) { return this.s[Map.PREFIX + key] = value; }
    // }
    //
    // function contains<T>(arr: T[], val: T) {
    //     for (var i in arr) { if (arr[i] == val) return true; }
    //     return false;
    // }
    //
    // function numCallSigChildren(ast: ISyntaxElement) {
    //     var numChildren = ast.childCount();
    //     var ans = 0;
    //     for (var i = 0; i < numChildren; i++) {
    //         //TODO: not sure why the non-null check is needed
    //         if (ast.childAt(i) && ast.childAt(i).kind() == SyntaxKind.CallSignature) {
    //             ans++;
    //         }
    //     }
    //     return ans;
    // }
    //
    // function getFirstCallSigChild(ast: ISyntaxElement) {
    //     var numChildren = ast.childCount();
    //     for (var i = 0; i < numChildren; i++) {
    //         //TODO: not sure why the non-null check is needed
    //         if (ast.childAt(i) && ast.childAt(i).kind() == SyntaxKind.CallSignature) {
    //             return ast.childAt(i);
    //         }
    //     }
    //     throw new Error("Don't call this function if ast has no CallSig childrem");
    // }
    //
    // export class OverloadStatGatherer {
    //     private static pre(ast: ISyntaxElement, state: OverloadState) {
    //         var callSigs: number;
    //         switch (ast.kind()) {
    //             //case SyntaxKind.ConstructorDeclaration:
    //             case SyntaxKind.FunctionDeclaration:
    //             case SyntaxKind.MemberFunctionDeclaration:
    //             case SyntaxKind.MethodSignature:
    //                 var functionDecl = state.semanticInfoChain.getDeclForAST(ast);
    //                 var name = functionDecl.name;
    //                 var funcSymbol = functionDecl.getSymbol();
    //                 var container = funcSymbol.getContainer();
    //                 var previouslySeenContainers = state.funcs.get(name);
    //                 if (!previouslySeenContainers) previouslySeenContainers = [];
    //                 if (contains(previouslySeenContainers, container)) return;
    //                 previouslySeenContainers.push(container);
    //                 state.funcs.set(name, previouslySeenContainers);
    //                 var funcTypeSymbol = funcSymbol.type;
    //                 callSigs = funcTypeSymbol.getCallSignatures().length;
    //                 break;
    //             default:
    //                 callSigs = numCallSigChildren(ast);
    //                 if (callSigs == 0) return;
    //                 break;
    //         }
    //         state.totalFuncs++;
    //         var overloaded = callSigs > 1;
    //         var optarged = OverloadStatGatherer.hasOptionalArg(ast);
    //         if (overloaded && optarged) state.overloadedIntersectOptargedFuncs++;
    //         if (overloaded) state.overloadFuncs++;
    //         if (optarged) state.optargedFuncs++;
    //     }
    //
    //     private static hasOptionalArg(ast: ISyntaxElement) {
    //         ast = getFirstCallSigChild(ast);
    //         var relStart = ast.start() - ast.fullStart();
    //         var funcText = ast.fullText().substring(relStart, relStart + ast.width());
    //         return funcText.indexOf("?") >= 0;
    //     }
    //
    //     public static gather(document: Document, semanticInfoChain: SemanticInfoChain) {
    //         var sourceUnit = document.sourceUnit();
    //         var state = new OverloadState(semanticInfoChain);
    //
    //         getAstWalkerFactory().simpleWalk(document.sourceUnit(),
    //             OverloadStatGatherer.pre, null, state);
    //
    //         console.log("Total functions: " + state.totalFuncs);
    //         console.log("Funcs both Overloaded and OptArg: " + state.overloadedIntersectOptargedFuncs);
    //         console.log("Overloaded functions: " + state.overloadFuncs);
    //         console.log("OptArg functions: " + state.optargedFuncs);
    //     }
    // }
}
