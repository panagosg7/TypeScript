
module ts {

    export const dcolon = "::";

    export class Pair<A, B> {
        constructor(private _fst: A, private _snd: B) { }
        public fst(): A { return this._fst; }
        public snd(): B { return this._snd; }
    }
    // export class Triple<A, B, C> {
    //     constructor(private _fst: A, private _snd: B, private _thd: C) { }
    //     public fst(): A { return this._fst; }
    //     public snd(): B { return this._snd; }
    //     public thd(): C { return this._thd; }
    // }

    export enum Assignability {
        WriteLocal,     // local reassignable
        WriteGlobal,    // global reassignable
        Ambient,        // ambient contexts (declare)
        ReadOnly,       // assigned only once

        Error
    }

    export enum AnnotationKind {

        // Declaration specific
        FunctionDeclarationRawSpec,    // Function specification
        VariableDeclarationRawSpec,    // Variable specification
        FunctionExpressionRawSpec,     // Anonymous function specification
        InterfaceRawSpec,              // Data type definition
        ModuleRawSpec,                 // Module specification
        ClassRawSpec,                  // Class specification
        FieldRawSpec,                  // Field specification
        MethodRawSpec,                 // Method specification
        ConstructorRawSpec,            // Constructor specification
        CallRawSpec,                   // Call specification
        CastRawSpec,                   // Cast
        ExportRawSpec,                 // Exported element
        AssignabilityRawSpec,          // Assignability specification

        // Global
        MeasureRawSpec,                // Measure
        TypeAliasRawSpec,              // Type alias
        PredicateAliasRawSpec,         // Predicate alias
        QualifierRawSpec,              // Qualifier
        InvariantRawSpec,              // Invariant
        OptionRawSpec,                 // RT Option

        // not imported to RSC
        TypeSignatureRawSpec           // Type signature

    }

    export enum AnnotContext {
        ClassMethod,               // Class method
        ClassField,                // Class field
        ClassContructor,           // Class constructor
        FunctionDeclaration,       // Function Declaration
        Other                      // Rest
    }

    export class Annotation {
        constructor(public sourceSpan: RsSrcSpan, public kind: AnnotationKind, public content: string) { }

        public serialize(): any {
            return aesonEncode(AnnotationKind[this.kind], [this.sourceSpan.serialize(), this.content]);
        }
    }

    export class FunctionDeclarationAnnotation extends Annotation {
        constructor(sourceSpan: RsSrcSpan, content: string) {
            super(sourceSpan, AnnotationKind.FunctionDeclarationRawSpec, content);
        }
    }

    export class ConstructorDeclarationAnnotation extends Annotation {
        constructor(sourceSpan: RsSrcSpan, content: string) {
            super(sourceSpan, AnnotationKind.ConstructorRawSpec, content);
        }
    }

    export class MethodDeclarationAnnotation extends Annotation {
        constructor(sourceSpan: RsSrcSpan, content: string) {
            super(sourceSpan, AnnotationKind.MethodRawSpec, content);
        }
    }

    export class TypeSignatureAnnotation extends Annotation {
        constructor(sourceSpan: RsSrcSpan, content: string) {
            super(sourceSpan, AnnotationKind.InterfaceRawSpec, content);
        }
    }

    export class InterfaceDeclarationAnnotation extends Annotation {
        constructor(sourceSpan: RsSrcSpan, content: string) {
            super(sourceSpan, AnnotationKind.InterfaceRawSpec, content);
        }
    }

    export class TypeAliasAnnotation extends Annotation {
        constructor(sourceSpan: RsSrcSpan, content: string) {
            super(sourceSpan, AnnotationKind.TypeAliasRawSpec, content);
        }
    }

    export class VariableDeclarationAnnotation extends Annotation {
        constructor(sourceSpan: RsSrcSpan, asgn: Assignability, public identifier: string, typeContent: string) {            
            super(sourceSpan, AnnotationKind.VariableDeclarationRawSpec, 
                [Assignability[asgn], identifier].join(" ") + ((typeContent) ? ["", dcolon, typeContent].join(" ") : ""));
        }
    }

    export class FunctionExpressionAnnotation extends Annotation {
        constructor(sourceSpan: RsSrcSpan, content: string) {
            super(sourceSpan, AnnotationKind.FunctionExpressionRawSpec, content);
        }
    }

    export class InterfaceAnnotation extends Annotation {
        constructor(sourceSpan: RsSrcSpan, content: string) {
            super(sourceSpan, AnnotationKind.InterfaceRawSpec, content);
        }
    }

    export class ModuleAnnotation extends Annotation {
        constructor(sourceSpan: RsSrcSpan, content: string) {
            super(sourceSpan, AnnotationKind.ModuleRawSpec, content);
        }
    }

    export class ClassAnnotation extends Annotation {
        constructor(sourceSpan: RsSrcSpan, content: string) {
            super(sourceSpan, AnnotationKind.ClassRawSpec, content);
        }
    }

    export class CallAnnotation extends Annotation {
        constructor(sourceSpan: RsSrcSpan, content: string) {
            super(sourceSpan, AnnotationKind.CallRawSpec, content);
        }
    }

    export class ExportedAnnotation extends Annotation {
        constructor(sourceSpan: RsSrcSpan) {
            super(sourceSpan, AnnotationKind.ExportRawSpec, "");
        }
    }

    export class PropertyAnnotation extends Annotation {
        constructor(sourceSpan: RsSrcSpan, content: string) {
            super(sourceSpan, AnnotationKind.FieldRawSpec, content);
        }
    }

    export class CastAnnotation extends Annotation {
        constructor(sourceSpan: RsSrcSpan, content: string) {
            super(sourceSpan, AnnotationKind.CastRawSpec, content);
        }
    }

    /** A class annotation that is inferred bassed on ts information. */
    export class RsInferredClassAnnotation extends ClassAnnotation {
        constructor(sourceSpan: RsSrcSpan, className: Identifier, typeParams: string[], _extends: RsType, _implements: RsType[]) {
            let r = "";
            r += "class ";
            r += className.text;
            if (typeParams && typeParams.length > 0) {
                r += " <";
                r += typeParams.join(", ");
                r += ">";
            }
            if (_extends) {
                r += " extends ";
                r += _extends.toString();
            }
            if (_implements && _implements.length > 0) {
                r += " implements ";
                r += _implements.map(t => t.toString()).join(", ");
            }
            super(sourceSpan, r);
        }
    }

    /** A class annotation provided by the user */
    export class ExplicitClassAnnotation extends ClassAnnotation {
        constructor(sourceSpan: RsSrcSpan, content: string) {
            super(sourceSpan, ["class", content].join(" "));
        }
    }

    /** An interface annotation provided by the user */
    export class ExplicitInterfaceAnnotation extends InterfaceAnnotation {
        constructor(sourceSpan: RsSrcSpan, content: string) {
            super(sourceSpan, content);
        }
    }

    // TODO parse these annotations separately in the end, so that we don't
    // have to deal with them while transforming the rest of the AST

    export class GlobalAnnotation extends Annotation {
        constructor(sourceSpan: RsSrcSpan, kind: AnnotationKind, public content: string) {
            super(sourceSpan, kind, content);
        }
    }

    export function isGlobalAnnotation(a: Annotation) {
        return a instanceof GlobalAnnotation;
    }

    export function makeVariableDeclarationAnnotation(rawContent: string, srcSpan: RsSrcSpan, node: VariableDeclaration, id: string, type: string): VariableDeclarationAnnotation[] 
    {
        let tokens = stringTokens(rawContent);
        if (!tokens || tokens.length <= 0) {
            throw new Error("[refscript] makeVariableDeclarationAnnotation called with empty token list");
        }
        if (isReservedAnnotationPrefix(tokens[0])) {
            return [];      // This has to be a global annotation -- ignore
        }
        let { restAsgn, asgn } = consumeAssignability(srcSpan, tokens, node);
        // handle the case of only assignability
        if (restAsgn && restAsgn.length <= 0) {
           return [new VariableDeclarationAnnotation(srcSpan, asgn, id, type)];
        }
        let { withouIdentifier, identifier } = consumeIdentifier(restAsgn);
        let withoutDColon = consumeDColon(withouIdentifier)
        let typeStr = withoutDColon.join(" ");
        return [new VariableDeclarationAnnotation(srcSpan, asgn, identifier, typeStr)];
    }

    export function makeVariableAssignability(rawContent: string, srcSpan: RsSrcSpan): Assignability[] {
        let tokens = stringTokens(rawContent);
        if (!tokens || tokens.length <= 0) {
            throw new Error("[refscript] makeVariableAssignability called with empty token list");
        }
        let { restAsgn, asgn } = consumeAssignability(srcSpan, tokens)
        if (restAsgn && restAsgn.length > 0) {
            throw new Error("[refscript] makeVariableAssignability returned non-empty token list");
        }
        return [asgn];
    }
    
    /**
     * Consume an assignability token (one of "readonly", "global" , "local"). If nothing is provided
     * assume WriteGlobal as default.
     */
    export function consumeAssignability(srcSpan: RsSrcSpan, tokens: string[], node?: VariableDeclaration) {
        if (!tokens || tokens.length <= 0) {
            throw new Error("[refscript] extractAssignabilityAnnotation called with empty token list");
        }
        if (isReservedAnnotationPrefix(tokens[0])) {
            throw new Error("[refscript] extractAssignabilityAnnotation did not expect token: " + tokens[0]);
        }
        switch (tokens[0]) {
            case "readonly":
                return {
                    restAsgn: tokens.slice(1),
                    asgn: Assignability.ReadOnly
                };
            case "global":
                return {
                    restAsgn: tokens.slice(1),
                    asgn: Assignability.WriteGlobal
                };
            case "local":
                return {
                    restAsgn: tokens.slice(1),
                    asgn: Assignability.WriteLocal
                };
            default:
                return {
                    restAsgn: tokens,
                    asgn: (node && isInAmbientContext(node)) ? Assignability.Ambient : Assignability.WriteGlobal
                }
        }
    }

    export function consumeIdentifier(tokens: string[]) {
        if (!tokens || tokens.length <= 0) {
            throw new Error("[refscript] extractIdentifier called with empty token list");
        }
        if (isReservedAnnotationPrefix(tokens[0])) {
            throw new Error("[refscript] extractIdentifier did not expect token: " + tokens[0]);
        }
        return {
            withouIdentifier: tokens.slice(1),
            identifier: tokens[0]
        }
    }

    export function consumeDColon(tokens: string[]) {
        if (!tokens || tokens.length <= 0) {
            throw new Error("[refscript] extractDColon called with empty token list");
        }
        if (tokens[0] !== "::") {
            throw new Error("[refscript] extractDColon did not expect token: " + tokens[0]);
        }
        return tokens.slice(1);
    }

    export function makeFunctionDeclarationAnnotation(s: string, srcSpan: RsSrcSpan): FunctionDeclarationAnnotation[] {
        let tokens = stringTokens(s);
        if (isReservedAnnotationPrefix(tokens[0])) {
            return [];
        }
        return [new FunctionDeclarationAnnotation(srcSpan, s)];
    }

    export function makeConstructorAnnotations(s: string, srcSpan: RsSrcSpan): ConstructorDeclarationAnnotation[] {
        let tokens = stringTokens(s);
        if (!tokens || tokens[0] !== "new")
            throw new Error("[refscript] Invalid constructor annotation: " + s);
        return [new ConstructorDeclarationAnnotation(srcSpan, s)];
    }

    export function makeMethodDeclarationAnnotations(s: string, srcSpan: RsSrcSpan): MethodDeclarationAnnotation[] {
        let tokens = stringTokens(s);
        if (isReservedAnnotationPrefix(tokens[0]))
            throw new Error("[refscript] Invalid method annotation: " + s);
        return [new MethodDeclarationAnnotation(srcSpan, s)];
    }

    export function makePropertyAnnotations(s: string, srcSpan: RsSrcSpan): PropertyAnnotation[] {
        let tokens = stringTokens(s);
        if (isReservedAnnotationPrefix(tokens[0]))
            throw new Error("[refscript] Invalid property annotation: " + s);
        return [new PropertyAnnotation(srcSpan, s)];
    }

    export function makeCallAnnotations(s: string, srcSpan: RsSrcSpan): CallAnnotation[] {
        let tokens = stringTokens(s);
        if (isReservedAnnotationPrefix(tokens[0]))
            throw new Error("[refscript] Invalid call annotation: " + s);
        return [new CallAnnotation(srcSpan, s)];
    }

    export function makeTypeSignatureAnnotation(s: string, srcSpan: RsSrcSpan): TypeSignatureAnnotation[] {
        let tokens = stringTokens(s);
        if (!tokens || tokens.length < 2 || tokens[0] !== "interface")
            return [];
        return [new TypeSignatureAnnotation(srcSpan, s)];
    }

    export function makeInterfaceDeclarationAnnotation(s: string, srcSpan: RsSrcSpan): InterfaceDeclarationAnnotation[] {
        let tokens = stringTokens(s);
        if (!tokens || tokens.length < 2 || tokens[0] !== "interface")
            throw new Error("[refscript] Invalid interface annotation: " + s);
        return [new InterfaceDeclarationAnnotation(srcSpan, s)];
    }

    export function makeTypeAliasAnnotations(s: string, srcSpan: RsSrcSpan): TypeAliasAnnotation[] {
        let tokens = stringTokens(s);
        if (tokens && tokens.length > 0 && tokens[0] === "type") {
            return [new TypeAliasAnnotation(srcSpan, s)];
        }
        return [];
    }

    export function makeClassStatementAnnotations(s: string, srcSpan: RsSrcSpan): ClassAnnotation[] {
        let tokens = stringTokens(s);
        if (tokens && tokens.length > 0 && tokens[0] === "class") {
            return [new ClassAnnotation(srcSpan, s)];
        }
        return [];
    }

    export function makeFunctionExpressionAnnotations(s: string, srcSpan: RsSrcSpan): FunctionExpressionAnnotation[] {
        let tokens = stringTokens(s);
        if (isReservedAnnotationPrefix(tokens[0]))
            throw new Error("[refscript] Invalid function expression annotation: " + s);
        return [new FunctionExpressionAnnotation(srcSpan, s)];
    }

    export function makeCastAnnotations(s: string, srcSpan: RsSrcSpan): CastAnnotation[] {
        return [new CastAnnotation(srcSpan, s)];
    }

    export function makeGlobalAnnotations(s: string, srcSpan: RsSrcSpan): GlobalAnnotation[] {
        let tokens = stringTokens(s);
        if (tokens && tokens.length > 0) {
            let content = tokens.slice(1).join(" ");
            switch (tokens[0]) {
                case "measure":
                    return [new GlobalAnnotation(srcSpan, AnnotationKind.MeasureRawSpec, content)];
                case "qualif":
                    return [new GlobalAnnotation(srcSpan, AnnotationKind.QualifierRawSpec, content)];
                case "predicate":
                    return [new GlobalAnnotation(srcSpan, AnnotationKind.PredicateAliasRawSpec, content)];
                case "invariant":
                    return [new GlobalAnnotation(srcSpan, AnnotationKind.InvariantRawSpec, content)];
                case "option":
                    return [new GlobalAnnotation(srcSpan, AnnotationKind.OptionRawSpec, content)];
            }
        }
        return [];
    }

    function isReservedAnnotationPrefix(s: string) {
        return (indexOfEq(["measure", "qualif", "interface", "alias", "class", "predicate", "invariant", "cast", "<anonymous>", "option"], s) !== -1);
    }

    /**
     * stringTokens
     * @param  {string}   s input string
     * @return {string[]}   an array of string containing the tokens of the input string
     */
    function stringTokens(s: string): string[] {
        return s.split(" ").filter(s => s.length > 0);
    }

}
