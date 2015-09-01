
//<reference path='..\ts.ts' />

module ts {

    export class Pair<A, B> {
        constructor(private _fst: A, private _snd: B) { }
        public fst(): A { return this._fst; }
        public snd(): B { return this._snd; }
    }
    export class Triple<A, B, C> {
        constructor(private _fst: A, private _snd: B, private _thd: C) { }
        public fst(): A { return this._fst; }
        public snd(): B { return this._snd; }
        public thd(): C { return this._thd; }
    }

    export enum Assignability {
        AWriteLocal,
        AWriteGlobal,
        AReadOnly,
        AErrorAssignability
    }

    export enum AnnotKind {
        RawMeas,     // Measure
        RawBind,     // Function / variable binder
        RawAmbBind,  // Ambient / variable binder
        RawFunc,     // Anonymous function type
        RawIface,    // Data type definition
        RawClass,    // Class annotations
        RawField,    // Field annotations
        RawMethod,   // Method annotations
        RawConstr,   // Constructor annotations
        RawTAlias,   // Type alias
        RawPAlias,   // Predicate alias
        RawQual,     // Qualifier
        RawInvt,     // Invariant
        RawCast,     // Cast
        RawExported, // Exported
        RawOption    // RT Option
    }

    export enum AnnotContext {
        ClassMethodContext,     // Class method
        ClassFieldContext,      // Class field
        ClassContructorContext, // Class constructor
        OtherContext            // Rest
    }

    export class RsAnnotation {

        constructor(private _sourceSpan: RsSrcSpan, private _kind: AnnotKind, private _content: string) { }

        public isGlob(): boolean { throw new Error("ABSTRACT: RsAnnotation.isGlob."); }

        /** This will create a RsAnnoation object based on user annotations */
        public static createAnnotation(s: string, ctx: AnnotContext, ss: RsSrcSpan): RsAnnotation {
            var triplet = RsAnnotation.stringTag(s);
            switch (triplet.fst()) {
                case AnnotKind.RawBind: {
                    switch (ctx) {
                        case AnnotContext.ClassMethodContext:
                            return new RsBindAnnotation(ss, AnnotKind.RawMethod, triplet.snd(), triplet.thd());

                        case AnnotContext.ClassFieldContext:
                            return new RsBindAnnotation(ss, AnnotKind.RawField, triplet.snd(), triplet.thd());

                        case AnnotContext.ClassContructorContext:
                            return new RsBindAnnotation(ss, AnnotKind.RawConstr, triplet.snd(), triplet.thd());

                        case AnnotContext.OtherContext:
                            return new RsBindAnnotation(ss, triplet.fst(), triplet.snd(), triplet.thd());

                        default:
                            throw new Error("BUG: there is no default context");
                    }
                }
                case AnnotKind.RawClass:
                    return new RsExplicitClassAnnotation(ss, triplet.thd());
                case AnnotKind.RawIface:
                    return new RsExplicitInterfaceAnnotation(ss, triplet.thd());
                default:
                    return new RsGlobalAnnotation(ss, triplet.fst(), triplet.thd());
            }
        }

        public sourceSpan(): RsSrcSpan {
            return this._sourceSpan;
        }

        public content(): string {
            return this._content;
        }

        public kind(): AnnotKind {
            return this._kind;
        }

        public serialize(): any {
            return ts.aesonEncode(AnnotKind[this.kind()], [this.sourceSpan().serialize(), this.content()]);
        }

        private static stringTag(s: string): Triple<AnnotKind, Assignability, string> {
            var tokens = RsAnnotation.stringTokens(s);
            if (tokens && tokens.length > 0) {

                // try to read some assignability first ...
                if (indexOfEq(["readonly", "local", "global"], tokens[0]) !== -1) {

                    // This is a bind ...
                    var asgn: Assignability;
                    switch (tokens[0]) {
                        case "readonly":
                            asgn = Assignability.AReadOnly;
                            break;
                        case "local":
                            asgn = Assignability.AWriteLocal;
                            break;
                        case "global":
                            asgn = Assignability.AWriteGlobal
                            break;
                        default:
                            asgn = Assignability.AErrorAssignability
                    }

                    var kind = RsAnnotation.toSpecKind(tokens[1]);
                    if (kind === AnnotKind.RawBind) {
                        var content = tokens.slice(1).join(" ");
                        return new Triple(AnnotKind.RawBind, asgn, content);
                    }
                    else {
                        throw new Error("RsAnnotation could not parse string tag: " + s + "\n" +
                            "'" + tokens[1] + "' is an invalid binder.");
                    }
                }

                // bind without an assignability modifier or something else ...
                var kind = RsAnnotation.toSpecKind(tokens[0]);
                if (kind === AnnotKind.RawBind) {

                    // if it's a bind and there is no assignability specified, assume "global" ...
                    return new Triple(AnnotKind.RawBind, Assignability.AErrorAssignability, tokens.join(" "));
                }
                else if (kind === AnnotKind.RawAmbBind) {
                    return new Triple(AnnotKind.RawAmbBind, Assignability.AErrorAssignability, tokens.join(" "));
                }
                else {
                    return new Triple(RsAnnotation.toSpecKind(tokens[0]), Assignability.AErrorAssignability, tokens.slice(1).join(" "));
                }
            }
            throw new Error("RsAnnotation could not parse string tag: " + s);
        }

        /** @stringTokens return an array of string containing \the tokens of the input string */
        private static stringTokens(s: string): string[] {
            return s.split(" ").filter(s => s.length > 0);
        }

        private static toSpecKind(s: string): AnnotKind {
            switch (s) {
                case "measure": return AnnotKind.RawMeas;
                case "qualif": return AnnotKind.RawQual;
                case "interface": return AnnotKind.RawIface;
                case "alias": return AnnotKind.RawTAlias;
                case "class": return AnnotKind.RawClass;
                case "predicate": return AnnotKind.RawPAlias;
                case "invariant": return AnnotKind.RawInvt;
                case "cast": return AnnotKind.RawCast;
                case "<anonymous>": return AnnotKind.RawFunc;
                case "option": return AnnotKind.RawOption;
                default: return AnnotKind.RawBind;
            }
        }
    }

    export class RsExported extends RsAnnotation {
        public isGlob(): boolean { return false; }
    }

    export class RsReadOnly extends RsAnnotation {
        public isGlob(): boolean { return false; }
    }

    export class RsBindAnnotation extends RsAnnotation {

        constructor(sourceSpan: RsSrcSpan, kind: AnnotKind, private asgn: Assignability, content: string) {
            super(sourceSpan, kind, content);
        }

        /** Returns true if this is a global annotation (can float to top-level).
            Compared to function / variable binders that need to be local to
            particular AST nodes.
        */
        public isGlob(): boolean { return true; }

        private _binderName: string = null;

        // public binderName(ast: ISyntaxElement, helper: RsHelper): string {
        public binderName(ast: Node, helper: RsHelper): string {
            if (this._binderName) return this._binderName;
            var content = this.content();
            // variable annotation
            var bs = content.split("::");
            if (bs && bs.length > 1) {
                var lhss = bs[0].split(" ").filter(s => s.length > 0);
                if (lhss && lhss.length === 1) {
                    this._binderName = lhss[0];
                    return this._binderName;
                }
            }
            // field annotation
            bs = content.split(":");
            if (bs && bs.length > 1) {
                var lhss = bs[0].split(" ").filter(s => s.length > 0);
                if (lhss && lhss.length === 1) {
                    this._binderName = lhss[0];
                    return this._binderName;
                }
                // The first argument may be the static modifier.
                if (lhss && lhss.length === 2) {
                    this._binderName = lhss[1];
                    return this._binderName;
                }
            }

            helper.postDiagnostic(ast, ts.Diagnostics.Invalid_RefScript_annotation_0_Perhaps_you_need_to_replace_Colon_with_Colon_Colon, [content]);
            return "";
        }

        public content(): string {
            var s = ""
            if (this.asgn === Assignability.AReadOnly) s += "readonly ";
            else if (this.asgn === Assignability.AWriteGlobal) s += "global ";
            else if (this.asgn === Assignability.AWriteLocal) s += "local ";
            return s + super.content();
        }
    }

    export class RsClassAnnotation extends RsAnnotation { }


    /** A class annotation that is inferred bassed on ts information. */
    export class RsInferredClassAnnotation extends RsClassAnnotation {

        constructor(
            sourceSpan: RsSrcSpan,
            private _className: Identifier,
            private _typeParams: string[],
            private _extends: Serializable,
            private _implements: Serializable[]) {
            super(sourceSpan, AnnotKind.RawClass, RsInferredClassAnnotation.toString(_className, _typeParams, _extends, _implements));
        }


        /** This is not a global annotation (cannot float to top-level).
         Needs to stick around a class declaration. */
        public isGlob(): boolean { return false; }

        private static toString(_className: Identifier, _typeParams: string[], _extends: Serializable, _implements: Serializable[]): string {
            var r = "";
            r += "class ";
            r += _className.text;
            if (_typeParams && _typeParams.length > 0) {
                r += " <";
                r += _typeParams.join(", ");
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
            return r;
        }
    }

    /** A class annotation provided by the user */
    export class RsExplicitClassAnnotation extends RsClassAnnotation {
        /** This is not a global annotation (cannot float to top-level).
         Needs to stick around a class declaration. */
        public isGlob(): boolean { return false; }

        constructor(sourceSpan: RsSrcSpan, content: string) {
            super(sourceSpan, AnnotKind.RawClass, content);
        }

        public content(): string {
            return "class " + super.content();
        }
    }

    /** An interface annotation provided by the user */
    export class RsExplicitInterfaceAnnotation extends RsClassAnnotation {
        /** This is not a global annotation (cannot float to top-level).
         Needs to stick around an interface declaration. */
        public isGlob(): boolean { return false; }

        constructor(sourceSpan: RsSrcSpan, content: string) {
            super(sourceSpan, AnnotKind.RawIface, content);
        }

        public content(): string {
            return super.content();
        }
    }



    export class RsGlobalAnnotation extends RsAnnotation {
        public isGlob(): boolean { return true; }

        constructor(sourceSpan: RsSrcSpan, kind: AnnotKind, content: string) {
            super(sourceSpan, kind, content);
        }

    }

}
