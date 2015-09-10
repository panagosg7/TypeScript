
//<reference path='..\ts.ts' />

module ts {

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
        WriteLocal,
        WriteGlobal,
        Ambient,
        Error
    }

    export enum AnnotationKind {
        // Local
        FunctionDeclarationRawSpec,    // Function specification
        VariableDeclarationRawSpec,    // Variable specification
        FunctionExpressionRawSpec,     // Anonymous function specification
        InterfaceRawSpec,              // Data type definition
        ClassRawSpec,                  // Class specification
        FieldRawSpec,                  // Field specification
        MethodRawSpec,                 // Method specification
        ConstructorRawSpec,            // Constructor specification
        CallRawSpec,                   // Call specification
        CastRawSpec,                   // Cast
        ExportRawSpec,                 // Exported element

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
        constructor(sourceSpan: RsSrcSpan, name: string, asgn: Assignability, type: string) {
            super(sourceSpan, AnnotationKind.VariableDeclarationRawSpec, [assignabilityToString(asgn), name, "::", type].join(" "));
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

    export class ClassAnnotation extends Annotation {
        constructor(sourceSpan: RsSrcSpan, content: string) {
            super(sourceSpan, AnnotationKind.ClassRawSpec, content);
        }
    }

    export class FieldAnnotation extends Annotation {
        constructor(sourceSpan: RsSrcSpan, content: string) {
            super(sourceSpan, AnnotationKind.FieldRawSpec, content);
        }
    }

    export class MethodAnnotation extends Annotation {
        constructor(sourceSpan: RsSrcSpan, content: string) {
            super(sourceSpan, AnnotationKind.MethodRawSpec, content);
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

    export class ConstructorAnnotation extends Annotation {
        constructor(sourceSpan: RsSrcSpan, content: string) {
            super(sourceSpan, AnnotationKind.ConstructorRawSpec, content);
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

    export function makeVariableDeclarationAnnotationFromString(s: string, srcSpan: RsSrcSpan, node?: VariableDeclaration): VariableDeclarationAnnotation[] {
        let tokens = stringTokens(s);

        if (!tokens || tokens.length <= 0)
            throw new Error("[refscript] RsAnnotation could not parse string tag: " + s);

        if (isReservedAnnotationPrefix(tokens[0]))
            return [];

        let assignability = stringToAssignability();
        let name = stringToName();
        let type = stringToType();

        return makeVariableDeclarationAnnotation(srcSpan, name, assignability, type, node);

        function stringToAssignability() {
            if (tokens[0] && (indexOfEq(["[readonly]", "[local]", "[global]"], tokens[0]) === -1)) {
                switch (tokens[0]) {
                    case "[readonly]":
                        return Assignability.Ambient;
                    case "[local]":
                        return Assignability.WriteLocal;
                    case "global":
                        return Assignability.WriteGlobal;
                    default:
                        return Assignability.WriteGlobal;
                }
            }
            return Assignability.WriteGlobal;
        }

        function stringToName() {
            let dcolonIdx = indexOfEq(tokens, "::");
            if (dcolonIdx > 0) {
                return tokens[dcolonIdx - 1];
            }
            throw new Error("[refscript] Invalid annotation: " + tokens.join(" "));
        }

        function stringToType() {
            let dcolonIdx = indexOfEq(tokens, "::");
            if (dcolonIdx > 0) {
                return tokens.slice(dcolonIdx + 1).join(" ");
            }
            throw new Error("[refscript] Invalid annotation: " + tokens.join(" "));
        }
    }

    export function makeVariableDeclarationAnnotation(srcSpan: RsSrcSpan, name: string, assignability: Assignability, type: string, node?: Node): VariableDeclarationAnnotation[] {
        // If this is an ambient declaration (declare var ... ), then overwrite the remaining annotations
        if (node && (getCombinedNodeFlags(node) & NodeFlags.Ambient)) {
            return [new VariableDeclarationAnnotation(srcSpan, name, Assignability.Ambient, type)];
        }
        return [new VariableDeclarationAnnotation(srcSpan, name, assignability, type)];
    }

    function assignabilityToString(assignability: Assignability): string {
        switch (assignability) {
            case Assignability.Ambient:
                return "ambient";
            case Assignability.WriteGlobal:
                return "global";
            case Assignability.WriteLocal:
                return "local";
            default:
                return "global";
        }
    }

    export function makeFunctionDeclarationAnnotation(s: string, srcSpan: RsSrcSpan): FunctionDeclarationAnnotation[] {
        let tokens = stringTokens(s);
        if (isReservedAnnotationPrefix(tokens[0])) {
            return [];
        }
        return [new FunctionDeclarationAnnotation(srcSpan, s)];
    }

    export function makeConstructorAnnotations(s: string, srcSpan: RsSrcSpan): ConstructorAnnotation[] {
        let tokens = stringTokens(s);
        if (!tokens || tokens[0] !== "new")
            throw new Error("[refscript] Invalid constructor annotation: " + s);
        return [new ConstructorAnnotation(srcSpan, s)];
    }

    export function makeMethodAnnotations(s: string, srcSpan: RsSrcSpan): MethodAnnotation[] {
        let tokens = stringTokens(s);
        if (isReservedAnnotationPrefix(tokens[0]))
            throw new Error("[refscript] Invalid method annotation: " + s);
        return [new MethodAnnotation(srcSpan, s)];
    }

    export function makePropertyAnnotations(s: string, srcSpan: RsSrcSpan): MethodAnnotation[] {
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

    /**
     * toSpecKind
     * @param  {string}         s the fist token appearing in a annotation string
     * @return {AnnotationKind}   the corresponding kind of the annotation
     */
    function toSpecKind(s: string): AnnotationKind {

        // TODO
        let ctx: AnnotContext = undefined;

        switch (s) {
            case "measure":
                return AnnotationKind.MeasureRawSpec;
            case "qualif":
                return AnnotationKind.QualifierRawSpec;
            case "interface":
                return AnnotationKind.InterfaceRawSpec;
            case "type":
                return AnnotationKind.TypeAliasRawSpec;
            case "class":
                return AnnotationKind.ClassRawSpec;
            case "predicate":
                return AnnotationKind.PredicateAliasRawSpec;
            case "invariant":
                return AnnotationKind.InvariantRawSpec;
            case "cast":
                return AnnotationKind.CastRawSpec;
            case "<anonymous>":
                return AnnotationKind.FunctionExpressionRawSpec;
            case "option":
                return AnnotationKind.OptionRawSpec;
            default:
                if (ctx === AnnotContext.FunctionDeclaration)
                    return AnnotationKind.FunctionDeclarationRawSpec;
                else
                    return AnnotationKind.VariableDeclarationRawSpec;
        }
    }
    // }

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
