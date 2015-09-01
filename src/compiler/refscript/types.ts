
//<reference path='..\typescript.ts' />


// Object representation of the type definition found here:
//
// https://github.com/UCSD-PL/RefScript/blob/develop/src/Language/Nano/Types.hs
//

module ts {

    export interface Serializable { toString(): string; }

    export class RsType implements Serializable {
        public toString(): string { throw new Error("BUG: Abstract in RsType toString()"); }
    }

    export class BoundedRsType {
        constructor(private symbol: string, private type: Serializable) { }

        public toString() { return this.symbol + ": " + this.type.toString(); }
    }

    export class TError extends RsType {
        constructor(private msg: string) { super(); }

        public toString(): string { return "Error type: " + this.msg; }

        public message(): string { return this.msg; }
    }

    export class TTopC extends RsType {
        public toString(): string { return "top"; }
    }

    export var TTop = new TTopC();

    export class TNumberC extends RsType {
        public toString(): string { return "number"; }
    }

    export var TNumber = new TNumberC();

    export class TStringC extends RsType {
        public toString(): string { return "string"; }
    }

    export var TString = new TStringC();

    export class TBooleanC extends RsType {
        public toString(): string { return "boolean"; }
    }

    export var TBoolean = new TBooleanC();

    export class TVoidC extends RsType {
        public toString(): string { return "void"; }
    }

    export var TVoid = new TVoidC();

    export class TObject extends RsType {
        constructor(public fields: RsTypeMember[]) { super(); }

        public toString(): string {
            var s = "";
            s += "{ ";
            s += this.fields.map(f => f.toString()).join("; ");
            s += " }";
            return s;
        }
    }

	export class TAll extends RsType {
		constructor(public param: string, public ty: RsType) { super(); }

		public toString(): string {
			var s = "";
			s += "forall ";
			s += this.param;
			s += " . "
			s += this.ty.toString();
			return s;
		}
	}


    export class RsFunctionLike extends RsType { }

    export class RsTFun extends RsFunctionLike {
        constructor(private tParams: TTypeParam[], private argTs: BoundedRsType[], private returnT: Serializable) {
            super();
        }

        public toString(): string {
            var s = "";
            if (this.tParams.length > 0) {
                s += "forall " + this.tParams.map(p => p.toString()).join(" ") + " . ";
            }
            s += "( ";
            s += this.argTs.map(b => b.toString()).join(", ");
            s += " ) => ";
            s += this.returnT.toString();
            return s;
        }
    }

    export class RsMeth extends RsFunctionLike {
        constructor(private tParams: TTypeParam[], private argTs: BoundedRsType[], private returnT: Serializable) {
            super();
        }

        public toString(): string {
            var s = "";
            if (this.tParams.length > 0) {
                s += "forall " + this.tParams.map(p => p.toString()).join(" ") + " . ";
            }
            s += "( ";
            s += this.argTs.map(b => b.toString()).join(", ");
            s += " ): ";
            s += this.returnT.toString();
            return s;
        }
    }

    export class RsTAnd<V extends RsFunctionLike> extends RsFunctionLike {
        constructor(private signatures: V[]) { super(); }

        public toString(): string {
            if (this.signatures && this.signatures.length > 0) {
                return (this.signatures.length == 1) ?
                    this.signatures[0].toString() :
                    ("\n" + this.signatures.map(s => "\t/\\ " + s.toString()).join("\n"));
            }
            else {
                return new TError("RsTAnd").toString();
            }
        }
    }

    export class TArray extends RsType {
        constructor(private eltT: Serializable) { super(); }

        public toString(): string { return "<" + this.eltT.toString() + ">"; }
    }

    export class TTypeReference extends RsType {
        constructor(private name: string, private params: RsType[]) { super(); }

        public toString(): string {
            var s = this.name;
            if (this.params && this.params.length > 0) {
                s += "<" + this.params.map(t => t.toString()).join(", ") + ">";
            }
            return s;
        }
    }

    export class TInterface implements Serializable {
        constructor(private ref: TTypeReference, private type: TObject) { }

        public toString() { return "type " + this.ref.toString() + " " + this.type.toString(); }
    }

    export class TTVar extends RsType {
        constructor(public name: string) { super(); }

        public toString() { return this.name; }
    }


    export class TTypeParam {
        constructor(public name: string) { }

        public toString(): string { return this.name; }
    }

    export class TTDef implements Serializable {
        constructor(public name: string, public pars: TTypeParam[], private proto: TParentType, private elts: RsTypeMember[]) { }

        public toString(): string {
            var s = "";
            s += name;
            s += " ";
            if (this.pars && this.pars.length > 0) {
                s += "< " + this.pars.map(a => a.toString()).join(", ") + ">";
            }
            //XXX: not implemented yet in the nano parser
            if (this.proto) {
                s += this.proto.toString
			}
            return;
        }
    }

    export class TParentType implements Serializable {
        constructor(private name: string, private targs: RsType[]) { }

        public toString(): string {
            return this.name + " " + this.targs.map(a => a.toString()).join(", ");
        }
    }


    /* ****************************************************************************
     *
     *				TypeMember
     *
     * ****************************************************************************/

    export class RsTypeMember implements Serializable { }

    // CallSig
    export class RsCallSig extends RsTypeMember {
        constructor(private type: RsType) {
            super();
        }

        public toString() {
            return this.type.toString();
        }
    }


    // ConsSig
    export class RsConsSig extends RsTypeMember {
        constructor(private type: RsType) {
            super();
        }

        public toString() {
            return "new " + this.type.toString();
        }
    }


    // IndexSig; TODO


    // FieldSig
    // TODO: Add mutability here
    export class RsFieldSig extends RsTypeMember {
        constructor(private name: string, private opt: boolean, private type: RsType) {
            super();
        }

        public toString() {
            return this.name + (this.opt ? "?" : "") + ": " + this.type.toString();
        }
    }


    // MethSig
    export class RsMethSig extends RsTypeMember {
		constructor(private name: string, private type: RsFunctionLike) {
            super();
        }

        public toString() {
            return this.name + ": " + this.type.toString();
        }
    }

    // Special case used for user annotations on type members
    export class RsRawStringMember extends RsTypeMember {
        constructor(private str: string) {
            super();
        }

        public toString() {
            return this.str;
        }
    }

	// StatSig:  These can't appear in object types


	////////////////////////////////
	// Mutability kind

	export enum MutabilityKind {
		MutableK,
		ImmutableK,
		ReadOnlyK,
		ParametricK,
		PresetK,		//set by caller
		DefaultK
	}



}
