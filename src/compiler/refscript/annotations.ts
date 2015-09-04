
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
        ReadOnly,
        Error
    }

    export enum AnnotationKind {
        // Local
        FunctionDeclaration,    // Function specification
        VariableDeclaration,    // Variable specification
        FunctionExpression,     // Anonymous function specification
        Interface,              // Data type definition
        Class,                  // Class specification
        Field,                  // Field specification
        Method,                 // Method specification
        Constructor,            // Constructor specification
        Cast,                   // Cast
        Exported,               // Exported
        Ambient,                // Ambient

        // Global
        Measure,                // Measure
        TypeAlias,              // Type alias
        PredicateAlias,         // Predicate alias
        Qualifier,              // Qualifier
        Invariant,              // Invariant
        Option                  // RT Option
    }

    export enum AnnotContext {
        ClassMethod,            // Class method
        ClassField,             // Class field
        ClassContructor,        // Class constructor
        FunctionDeclaration,    // Function Declaration
        Other                   // Rest
    }

    export class Annotation {
        constructor(public sourceSpan: RsSrcSpan, public kind: AnnotationKind) { }

        public serialize(): any {
            throw new Error("[refscript] Method 'serialize' needs to be instantiated in a subclass of RsAnnotation.");
            // return ts.aesonEncode(AnnotationKind[this.kind], [this.sourceSpan.serialize(), this.content()]);
        }
    }


    export class SingleContentAnnotation extends Annotation {
        constructor(sourceSpan: RsSrcSpan, kind: AnnotationKind, private content: string) {
            super(sourceSpan, kind);
        }

        public serialize(): any {
            return ts.aesonEncode(AnnotationKind[this.kind], [this.sourceSpan.serialize(), this.content]);
        }

        public getContent(): string {
            return this.content;
        }
    }

    export class FunctionDeclarationAnnotation extends SingleContentAnnotation {
        constructor(sourceSpan: RsSrcSpan, content: string) {
            super(sourceSpan, AnnotationKind.FunctionExpression, content);
        }
    }

    export class VariableDeclarationAnnotation extends SingleContentAnnotation {
        constructor(sourceSpan: RsSrcSpan, public asgn: Assignability, content: string) {
            super(sourceSpan, AnnotationKind.VariableDeclaration, content);
        }

        public name: string;

        public getName(node: Node, state: RsTranslationState): string {
            if (this.name)
                return this.name;

            // variable annotation
            var bs = this.getContent().split("::");
            if (bs && bs.length > 1) {
                let lhss = bs[0].split(" ").filter(s => s.length > 0);
                if (lhss && lhss.length === 1) {
                    this.name = lhss[0];
                    return this.name;
                }
            }

            state.postDiagnostic(node, ts.Diagnostics.Invalid_RefScript_annotation_0_Perhaps_you_need_to_replace_Colon_with_Colon_Colon, [this.getContent()]);
            return "";
        }

        public getContent(): string {
            let s = "";
            if (this.asgn === Assignability.ReadOnly) s += "readonly ";
            else if (this.asgn === Assignability.WriteGlobal) s += "global ";
            else if (this.asgn === Assignability.WriteLocal) s += "local ";
            return s + super.getContent();
        }
    }

    export class FunctionExpressionAnnotation extends SingleContentAnnotation {
        constructor(sourceSpan: RsSrcSpan, content: string) {
            super(sourceSpan, AnnotationKind.FunctionExpression, content);
        }
    }

    export class InterfaceAnnotation extends SingleContentAnnotation {
        constructor(sourceSpan: RsSrcSpan, content: string) {
            super(sourceSpan, AnnotationKind.Interface, content);
        }
    }

    export class ClassAnnotation extends SingleContentAnnotation {
        constructor(sourceSpan: RsSrcSpan, content: string) {
            super(sourceSpan, AnnotationKind.Class, content);
        }
    }

    export class FieldAnnotation extends SingleContentAnnotation {
        constructor(sourceSpan: RsSrcSpan, content: string) {
            super(sourceSpan, AnnotationKind.Field, content);
        }

        public name: string;

        public getName(node: Node, state: RsTranslationState): string {
            if (this.name)
                return this.name;

            let bs = this.getContent().split(":");
            if (bs && bs.length > 1) {
                var lhss = bs[0].split(" ").filter(s => s.length > 0);
                if (lhss && lhss.length === 1) {
                    this.name = lhss[0];
                    return this.name;
                }
                // The first argument may be the static modifier.
                if (lhss && lhss.length === 2) {
                    this.name = lhss[1];
                    return this.name;
                }
            }

            state.postDiagnostic(node, ts.Diagnostics.Invalid_RefScript_annotation_0_Perhaps_you_need_to_replace_Colon_with_Colon_Colon, [this.getContent()]);
            return "";
        }
    }

    export class MethodAnnotation extends SingleContentAnnotation {
        constructor(sourceSpan: RsSrcSpan, content: string) {
            super(sourceSpan, AnnotationKind.Method, content);
        }
    }

    export class ConstructorAnnotation extends SingleContentAnnotation {
        constructor(sourceSpan: RsSrcSpan, content: string) {
            super(sourceSpan, AnnotationKind.Constructor, content);
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
            super(sourceSpan, content);
        }

        public getContent(): string {
            return "class " + super.getContent();
        }
    }

    /** An interface annotation provided by the user */
    export class ExplicitInterfaceAnnotation extends InterfaceAnnotation {
        constructor(sourceSpan: RsSrcSpan, content: string) {
            super(sourceSpan, content);
        }
    }

    export class ExportedAnnotation extends Annotation {
        constructor(sourceSpan: RsSrcSpan) {
            super(sourceSpan, AnnotationKind.Exported);
        }
    }

    export class AmbientAnnotation extends Annotation {
        constructor(sourceSpan: RsSrcSpan) {
            super(sourceSpan, AnnotationKind.Ambient);
        }
    }

    // TODO parse these annotations separately in the end, so that we don't
    // have to deal with them while transforming the rest of the AST

    export class GlobalAnnotation extends Annotation {
        constructor(sourceSpan: RsSrcSpan, kind: AnnotationKind, public content: string) {
            super(sourceSpan, kind);
        }
    }

    export function isGlobalAnnotation(a: Annotation) {
        return a instanceof GlobalAnnotation;
    }

    export function makeVariableDeclarationAnnotation(s: string, srcSpan: RsSrcSpan): VariableDeclarationAnnotation[] {
        let tokens = stringTokens(s);

        if (!tokens || tokens.length <= 0)
            throw new Error("RsAnnotation could not parse string tag: " + s);

        // try to read some assignability first, using 'Global' as default
        let asgn = stringToAssignability(tokens[0]);
        let content = tokens.slice(1).join(" ");

        return [new VariableDeclarationAnnotation(srcSpan, asgn, content)];

        function stringToAssignability(str: string) {
            switch (str) {
                case "readonly":
                    return Assignability.ReadOnly;
                case "local":
                    return Assignability.WriteLocal;
                case "global":
                    return Assignability.WriteGlobal;
                default:
                    return Assignability.WriteGlobal;
            }
        }
    }

    export function makeFunctionDeclarationAnnotation(s: string, srcSpan: RsSrcSpan): FunctionDeclarationAnnotation[] {
        let tokens = stringTokens(s);
        if (isReservedAnnotationPrefix(tokens[0])) {
            return [];
        }
        return [new FunctionDeclarationAnnotation(srcSpan, s)];
    }

    //
    // export function createAnnotation(s: string, ctx: AnnotContext, ss: RsSrcSpan): Annotation {
    //
    //     var triplet = stringTag(s);
    //
    //     switch (triplet.fst()) {
    //
    //         case AnnotationKind.RawBind: {
    //             switch (ctx) {
    //                 case AnnotContext.ClassMethod:
    //                     return new VariableDeclarationAnnotation(ss, AnnotationKind.Method, triplet.snd(), triplet.thd());
    //                 case AnnotContext.ClassFieldContext:
    //                     return new VariableDeclarationAnnotation(ss, AnnotationKind.Field, triplet.snd(), triplet.thd());
    //                 case AnnotContext.ClassContructor:
    //                     return new VariableDeclarationAnnotation(ss, AnnotationKind.Constructor, triplet.snd(), triplet.thd());
    //                 case AnnotContext.OtherContext:
    //                     return new VariableDeclarationAnnotation(ss, triplet.fst(), triplet.snd(), triplet.thd());
    //                 default:
    //                     throw new Error("BUG: there is no default context");
    //             }
    //         }
    //         case AnnotationKind.Class:
    //             return new RsExplicitClassAnnotation(ss, triplet.thd());
    //         case AnnotationKind.Interface:
    //             return new RsExplicitInterfaceAnnotation(ss, triplet.thd());
    //         default:
    //             return new RsGlobalAnnotation(ss, triplet.fst(), triplet.thd());
    //     }
    //
    //     type TagInfo = { bind: AnnotationKind; asgn: Assignability, content: string };
    //
    //     /**
    //      * stringTag
    //      * @param  {string}  s annotation string
    //      * @return {TagInfo}   information concering the specific annotation string
    //      */
    //     function stringTag(s: string): TagInfo {
    //
    //         let tokens = stringTokens(s);
    //
    //         if (!tokens || tokens.length <= 0)
    //             throw new Error("RsAnnotation could not parse string tag: " + s);
    //
    //
    //         // bind without an assignability modifier or something else ...
    //         var kind = toSpecKind(tokens[0]);
    //         if (kind === AnnotationKind.RawBind) {
    //
    //             // if it's a bind and there is no assignability specified, assume "global" ...
    //             return {
    //                 bind: AnnotationKind.RawBind,
    //                 asgn: Assignability.Error,
    //                 content: tokens.join(" ")
    //             };
    //         }
    //         else if (kind === AnnotationKind.AmbientBinder) {
    //
    //             return {
    //                 bind: AnnotationKind.AmbientBinder,
    //                 asgn: Assignability.Error,
    //                 content: tokens.join(" ")
    //             };
    //
    //         }
    //         else {
    //
    //             return {
    //                 bind: Annotation.toSpecKind(tokens[0]),
    //                 asgn: Assignability.Error,
    //                 content: tokens.slice(1).join(" ")
    //             };
    //
    //         }
    //
    //     }

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
                    return AnnotationKind.Measure;
                case "qualif":
                    return AnnotationKind.Qualifier;
                case "interface":
                    return AnnotationKind.Interface;
                case "alias":
                    return AnnotationKind.TypeAlias;
                case "class":
                    return AnnotationKind.Class;
                case "predicate":
                    return AnnotationKind.PredicateAlias;
                case "invariant":
                    return AnnotationKind.Invariant;
                case "cast":
                    return AnnotationKind.Cast;
                case "<anonymous>":
                    return AnnotationKind.FunctionExpression;
                case "option":
                    return AnnotationKind.Option;
                default:
                    if (ctx === AnnotContext.FunctionDeclaration)
                        return AnnotationKind.FunctionDeclaration;
                    else
                        return AnnotationKind.VariableDeclaration;
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
