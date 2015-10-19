//<reference path='..\typescript.ts' />

// Object representation of the AST definition found here:
//
// https://github.com/UCSD-PL/RefScript/blob/master/src/Language/Rsc/AST/Syntax.hs
//
// The serialization works with aeson-0.8.0.2
//

module ts {

    export function aesonEncode(tag: string, content: any): any {
        return {
            "tag": tag,
            "contents": content
        };
    }

    export enum AesonCtor {
        WITH_CTOR,
        NO_CTOR
    }

    export interface IRsAST {
        serialize(): any;
        _toAeson(tag: string, content: any[], ctor: AesonCtor): any;
    }

    export class RsAST {
        public serialize(): any {
            throw new Error("RsAST: child class should implement serialize");
        }

        // No annotation field here
        public _toAeson(tag: string, content: any, ctor: AesonCtor) {
            if (ctor === AesonCtor.NO_CTOR) {
                return content;
            }
            else {
                return aesonEncode(tag, content);
            }
        }
    }

    export class RsSrcSpan {
        public serialize(): any {
            //Doing the line and col fix here.
            return {
                "sp_start": [this.file, this.start.line + 1, this.start.character + 1],
                "sp_stop": [this.file, this.stop.line + 1, this.stop.character + 1]
            };
        }

        public toString(): string {
            return this.file + ": (" + (this.start.line + 1) + ", " + (this.start.character + 1) +
                ") - (" + (this.stop.line + 1) + ", " + (this.stop.character + 1) + ")";
        }

        constructor(private file: string, private start: LineAndCharacter, private stop: LineAndCharacter) { }
    }

    export class RsList<T extends RsAST> extends RsAST {
        constructor(public members: T[]) { super(); }

        public serialize(): any {
            return this.members.map(m => m.serialize());
        }

        public prefixElement(element: T) {
            this.members.push(element);
        }
    }

    export class RsPair<S extends RsAST, T extends RsAST> extends RsAST {
        constructor(public fst: S, public snd: T) { super(); }

        public serialize(): any {
            return [this.fst.serialize(), this.snd.serialize()];
        }
    }

    export interface IRsMaybe<T extends RsAST> {
        serialize(): any;
    }

    export class RsJust<T extends RsAST> extends RsAST implements IRsMaybe<T> {
        constructor(public content: T) {
            super();
        }

        public serialize(): any {
            return this.content.serialize();
        }
    }

    export class RsNothing extends RsAST implements IRsMaybe<any> {
        public serialize(): any {
            return null;
        }
    }

    export class RsAnnotatedAST extends RsAST {
        constructor(public span: RsSrcSpan, public ann: Annotation[]) { super(); }

        public mapAnn<T>(f: (a: Annotation) => T): T[] {
            return this.ann.filter(a => a !== null).map(f);
        }

        // This one adds the annotation field first
        public _toAeson(tag: string, content: any, ctor: AesonCtor) {
            if (ctor === AesonCtor.WITH_CTOR) {
                if (content instanceof Array && content.length === 0) {
                    return aesonEncode(tag, [this.span.serialize(), this.ann.map(a => a.serialize())]);
                }
                else {
                    return aesonEncode(tag, [[this.span.serialize(), this.ann.map(a => a.serialize())]].concat(content));
                }
            }
            else {
                return [[this.span.serialize(), this.ann.map(a => a.serialize())]].concat(content);
            }
        }
    }

    export class RsId extends RsAnnotatedAST {
        constructor(public span: RsSrcSpan, public ann: Annotation[], public id: string) { super(span, ann); }

        public serialize(): any {
            return this._toAeson("Id", [this.id], AesonCtor.NO_CTOR);
        }
    }

    // Includes normal and ambient declarations
    export interface IRsVarDeclLike extends IRsAST {
        serialize(): any;
        span: RsSrcSpan;
        ann: Annotation[];
    }

    export class RsVarDecl extends RsAnnotatedAST implements IRsVarDeclLike {
        public serialize(): any {
            return this._toAeson("VarDecl", [this.name.serialize(), this.exp.serialize()], AesonCtor.NO_CTOR);
        }

        constructor(public span: RsSrcSpan, public ann: Annotation[], public name: RsId, public exp: IRsMaybe<RsExpression>) {
            super(span, ann);
        }
    }

    export class RsPropId extends RsAnnotatedAST {
        public serialize(): any {
            return this._toAeson("PropId", [this.f.serialize()], AesonCtor.WITH_CTOR);
        }

        constructor(public span: RsSrcSpan, public ann: Annotation[], public f: RsId) {
            super(span, ann);
        }
    }

    export class RsPropString extends RsAnnotatedAST {
        public serialize(): any {
            return this._toAeson("PropString", [this.s], AesonCtor.WITH_CTOR);
        }

        constructor(public span: RsSrcSpan, public ann: Annotation[], public s: string) {
            super(span, ann);
        }
    }

    export class RsPropNum extends RsAnnotatedAST {
        public serialize(): any {
            return this._toAeson("PropNum", [this.n], AesonCtor.WITH_CTOR);
        }

        constructor(public span: RsSrcSpan, public ann: Annotation[], public n: number) {
            super(span, ann);
        }
    }


    ////  ForInit

    export class RsForInit extends RsAST { }

    export class RsNoInit extends RsForInit {
        public serialize(): any {
            return this._toAeson("NoInit", [], AesonCtor.WITH_CTOR);
        }

        constructor(public span: RsSrcSpan, public ann: Annotation[]) {
            super();
        }
    }

    export class RsVarInit extends RsForInit {
        public serialize(): any {
            return this._toAeson("VarInit", this.vds.serialize(), AesonCtor.WITH_CTOR);
        }

        constructor(public span: RsSrcSpan, public ann: Annotation[], public vds: RsList<RsVarDecl>) {
            super();
        }
    }

    export class RsExprInit extends RsForInit {
        public serialize(): any {
            return this._toAeson("ExprInit", this.exp.serialize(), AesonCtor.WITH_CTOR);
        }

        constructor(public exp: RsExpression) {
            super();
        }
    }


    //// ForInInit

    export class RsForInInit extends RsAST { }

    export class RsForInVar extends RsForInInit {
        public serialize(): any {
            return this._toAeson("ForInVar", this.id.serialize(), AesonCtor.WITH_CTOR);
        }

        constructor(private id: RsId) {
            super();
        }
    }

    export class RsForInLVal extends RsForInInit {
        public serialize(): any {
            return this._toAeson("ForInLVal", this.lval.serialize(), AesonCtor.WITH_CTOR);
        }

        constructor(public lval: RsLValue) {
            super();
        }
    }


    //// Operators

    export enum RsInfixOpKind {
        OpLT
        , OpLEq
        , OpGT
        , OpGEq
        , OpIn
        , OpInstanceof
        , OpEq
        , OpNEq
        , OpStrictEq
        , OpStrictNEq
        , OpLAnd
        , OpLOr
        , OpMul
        , OpDiv
        , OpMod
        , OpSub
        , OpLShift
        , OpSpRShift
        , OpZfRShift
        , OpBAnd
        , OpBXor
        , OpBOr
        , OpAdd
    }

    export class RsInfixOp extends RsAST {
        private _opKind: RsInfixOpKind;

        private signToOpKind(): RsInfixOpKind {
            switch (this.sign) {
                case "<": return RsInfixOpKind.OpLT;
                case "<=": return RsInfixOpKind.OpLEq;
                case ">": return RsInfixOpKind.OpGT;
                case ">=": return RsInfixOpKind.OpGEq;
                case "in": return RsInfixOpKind.OpIn;
                case "instanceof": return RsInfixOpKind.OpInstanceof;
                case "==": return RsInfixOpKind.OpEq;
                case "!=": return RsInfixOpKind.OpNEq;
                case "===": return RsInfixOpKind.OpStrictEq;
                case "!==": return RsInfixOpKind.OpStrictNEq;
                case "&&": return RsInfixOpKind.OpLAnd;
                case "||": return RsInfixOpKind.OpLOr;
                case "*": return RsInfixOpKind.OpMul;
                case "/": return RsInfixOpKind.OpDiv;
                case "%": return RsInfixOpKind.OpMod;
                case "-": return RsInfixOpKind.OpSub;
                case "<<": return RsInfixOpKind.OpLShift;
                case ">>": return RsInfixOpKind.OpSpRShift;
                case ">>>": return RsInfixOpKind.OpZfRShift;
                case "&": return RsInfixOpKind.OpBAnd;
                case "^": return RsInfixOpKind.OpBXor;
                case "|": return RsInfixOpKind.OpBOr;
                case "+": return RsInfixOpKind.OpAdd;
            };
            throw new Error("Case: " + this.sign + " not handled in RsInfixOp.signToOpKind");
        }

        public serialize() {
            return RsInfixOpKind[this.signToOpKind()];
        }

        constructor(public sign: string) {
            super();
            this._opKind = this.signToOpKind();
        }
    }

    export enum RsAssignOpKind {
        OpAssign,
        OpAssignAdd,
        OpAssignSub,
        OpAssignMul,
        OpAssignDiv,
        OpAssignLShift,
        OpAssignSpRShift,
        OpAssignZfRShift,
        OpAssignBAnd,
        OpAssignBXor,
        OpAssignBOr
    }

    export class RsAssignOp extends RsAST {
        private _opKind: RsAssignOpKind;

        private signToOpKind(): RsAssignOpKind {
            switch (this.sign) {
                case "=": return RsAssignOpKind.OpAssign;
                case "+=": return RsAssignOpKind.OpAssignAdd;
                case "-=": return RsAssignOpKind.OpAssignSub;
                case "*=": return RsAssignOpKind.OpAssignMul;
                case "/=": return RsAssignOpKind.OpAssignDiv;
                case "<<=": return RsAssignOpKind.OpAssignLShift;
                case ">>=": return RsAssignOpKind.OpAssignSpRShift;
                case ">>>=": return RsAssignOpKind.OpAssignZfRShift;
                case "&=": return RsAssignOpKind.OpAssignBAnd;
                case "^=": return RsAssignOpKind.OpAssignBXor;
                case "|=": return RsAssignOpKind.OpAssignBOr;
            };
            throw new Error("Case: " + this.sign + " not handled in RsAssignOp.signToOpKind");
        }

        public serialize() {
            return RsAssignOpKind[this.signToOpKind()];
        }

        constructor(public sign: string) {
            super();
            this._opKind = this.signToOpKind();
        }
    }

    export enum RsUnaryAssignOpKind {
        PrefixInc,
        PrefixDec,
        PostfixInc,
        PostfixDec
    }

    export class RsUnaryAssignOp extends RsAST {
        public serialize() {
            return RsUnaryAssignOpKind[this.opKind];
        }

        constructor(public opKind: RsUnaryAssignOpKind) {
            super();
        }
    }

    export enum RsPrefixOpKind {
        PrefixLNot,
        PrefixBNot,
        PrefixPlus,
        PrefixMinus,
        PrefixTypeof,
        PrefixVoid,
        PrefixDelete
    }

    export class RsPrefixOp extends RsAST {
        public serialize() {
            return RsPrefixOpKind[this.opKind];
        }

        constructor(public opKind: RsPrefixOpKind) {
            super();            
        }
    }


    //// LValue

    export class RsLValue extends RsAnnotatedAST { }

    export class RsLVar extends RsLValue {
        public serialize(): any {
            return this._toAeson("LVar", [this.s], AesonCtor.WITH_CTOR);
        }

        constructor(public span: RsSrcSpan, public ann: Annotation[], public s: string) {
            super(span, ann);
        }
    }

    export class RsLDot extends RsLValue {
        public serialize(): any {
            return this._toAeson("LDot", [this.exp.serialize(), this.str], AesonCtor.WITH_CTOR);
        }

        constructor(public span: RsSrcSpan, public ann: Annotation[], public exp: RsExpression, public str: string) {
            super(span, ann);
        }
    }

    export class RsLBracket extends RsLValue {
        public serialize(): any {
            return this._toAeson("LBracket", [this.e1.serialize(), this.e2.serialize()], AesonCtor.WITH_CTOR);
        }

        constructor(public span: RsSrcSpan, public ann: Annotation[], public e1: RsExpression, public e2: RsExpression) {
            super(span, ann);
        }
    }


    //// Expression

    export class RsExpression extends RsAnnotatedAST { }

    export class RsInfixExpr extends RsExpression {
        public serialize() {
            return this._toAeson("InfixExpr", [this.op.serialize(), this.operand1.serialize(), this.operand2.serialize()], AesonCtor.WITH_CTOR);
        }

        constructor(public span: RsSrcSpan, public ann: Annotation[], public op: RsInfixOp, public operand1: RsExpression, public operand2: RsExpression) {
            super(span, ann);
        }
    }

    export class RsCondExpr extends RsExpression {
        public serialize() {
            return this._toAeson("CondExpr", [this.cond.serialize(), this.exp1.serialize(), this.exp2.serialize()], AesonCtor.WITH_CTOR);
        }

        constructor(public span: RsSrcSpan, public ann: Annotation[], public cond: RsExpression, public exp1: RsExpression, public exp2: RsExpression) {
            super(span, ann);
        }
    }

    export class RsNumLit extends RsExpression {
        public serialize() {
            return this._toAeson("NumLit", [this.num], AesonCtor.WITH_CTOR);
        }

        constructor(public span: RsSrcSpan, public ann: Annotation[], public num: number) {
            super(span, ann);
        }
    }

    export class RsIntLit extends RsExpression {
        public serialize() {
            return this._toAeson("IntLit", [this.num], AesonCtor.WITH_CTOR);
        }

        constructor(public span: RsSrcSpan, public ann: Annotation[], public num: number) {
            super(span, ann);
        }
    }

    export class RsHexLit extends RsExpression {
        public serialize() {
            return this._toAeson("HexLit", [this.num], AesonCtor.WITH_CTOR);
        }

        constructor(public span: RsSrcSpan, public ann: Annotation[], public num: string) {
            super(span, ann);
        }
    }

    export class RsStringLit extends RsExpression {
        public serialize() {
            //Quotes fix
            var l = this.str.length;
            var newStr = this.str;
            if (l > 1 && (newStr[0] === '\"' && newStr[l - 1] === '\"' ||
                newStr[0] === '\'' && newStr[l - 1] === '\'')) {
                newStr = newStr.substring(1, l - 1);
            }
            return this._toAeson("StringLit", [newStr], AesonCtor.WITH_CTOR);
        }

        constructor(public span: RsSrcSpan, public ann: Annotation[], public str: string) {
            super(span, ann);
        }
    }

    export class RsFuncExpr extends RsExpression {
        public serialize() {
            return this._toAeson("FuncExpr", [this.id.serialize(), this.args.serialize(), this.body.serialize()], AesonCtor.WITH_CTOR);
        }

        constructor(public span: RsSrcSpan, public ann: Annotation[], public id: IRsMaybe<RsId>, public args: RsList<RsId>, public body: RsList<RsStatement>) {
            super(span, ann);
        }
    }

    export class RsVarRef extends RsExpression {
        public serialize() {
            return this._toAeson("VarRef", [this.id.serialize()], AesonCtor.WITH_CTOR);
        }

        constructor(public span: RsSrcSpan, public ann: Annotation[], public id: RsId) {
            super(span, ann);
        }
    }

    export class RsDotRef extends RsExpression {
        public serialize() {
            return this._toAeson("DotRef", [this.expression.serialize(), this.id.serialize()], AesonCtor.WITH_CTOR);
        }

        constructor(public span: RsSrcSpan, public ann: Annotation[], public expression: RsExpression, public id: RsId) {
            super(span, ann);
        }
    }

    export class RsBracketRef extends RsExpression {
        public serialize() {
            return this._toAeson("BracketRef", [this.e1.serialize(), this.e2.serialize()], AesonCtor.WITH_CTOR);
        }

        constructor(public span: RsSrcSpan, public ann: Annotation[], public e1: RsExpression, public e2: RsExpression) {
            super(span, ann);
        }
    }

    export class RsCallExpr extends RsExpression {
        public serialize() {
            return this._toAeson("CallExpr", [this.target.serialize(), this.args.serialize()], AesonCtor.WITH_CTOR);
        }

        constructor(public span: RsSrcSpan, public ann: Annotation[], public target: RsExpression, public args: RsList<RsExpression>) {
            super(span, ann);
        }
    }

    export class RsObjectLit extends RsExpression {
        public serialize() {
            return this._toAeson("ObjectLit", [this.bindings.serialize()], AesonCtor.WITH_CTOR);
        }

        constructor(public span: RsSrcSpan, public ann: Annotation[], public bindings: RsList<RsAST>) {
            super(span, ann);
        }
    }

    export class RsAssignExpr extends RsExpression {
        public serialize() {
            return this._toAeson("AssignExpr", [this.assignOp.serialize(), this.lval.serialize(), this.expression.serialize()], AesonCtor.WITH_CTOR);
        }

        constructor(public span: RsSrcSpan, public ann: Annotation[], public assignOp: RsAssignOp, public lval: RsLValue, public expression: RsExpression) {
            super(span, ann);
        }
    }

    export class RsThisRef extends RsExpression {
        public serialize() {
            return this._toAeson("ThisRef", [], AesonCtor.WITH_CTOR);
        }

        constructor(public span: RsSrcSpan, public ann: Annotation[]) {
            super(span, ann);
        }
    }

    export class RsSuperRef extends RsExpression {
        public serialize() {
            return this._toAeson("SuperRef", [], AesonCtor.WITH_CTOR);
        }

        constructor(public span: RsSrcSpan, public ann: Annotation[]) {
            super(span, ann);
        }
    }

    export class RsNullLit extends RsExpression {
        public serialize() {
            return this._toAeson("NullLit", [], AesonCtor.WITH_CTOR);
        }

        constructor(public span: RsSrcSpan, public ann: Annotation[]) {
            super(span, ann);
        }
    }

    export class RsBoolLit extends RsExpression {
        public serialize() {
            return this._toAeson("BoolLit", [this.b], AesonCtor.WITH_CTOR);
        }

        constructor(public span: RsSrcSpan, public ann: Annotation[], public b: boolean) {
            super(span, ann);
        }
    }

    export class RsNewExpr extends RsExpression {
        public serialize() {
            return this._toAeson("NewExpr", [this.e.serialize(), this.es.serialize()], AesonCtor.WITH_CTOR);
        }

        constructor(public span: RsSrcSpan, public ann: Annotation[], public e: RsExpression, public es: RsList<RsExpression>) {
            super(span, ann);
        }
    }

    export class RsUnaryAssignExpr extends RsExpression {
        public serialize() {
            return this._toAeson("UnaryAssignExpr", [this.op.serialize(), this.lval.serialize()], AesonCtor.WITH_CTOR);
        }

        constructor(public span: RsSrcSpan, public ann: Annotation[], public op: RsUnaryAssignOp, public lval: RsLValue) {
            super(span, ann);
        }
    }

    export class RsPrefixExpr extends RsExpression {
        public serialize() {
            return this._toAeson("PrefixExpr", [this.op.serialize(), this.exp.serialize()], AesonCtor.WITH_CTOR);
        }

        constructor(public span: RsSrcSpan, public ann: Annotation[], public op: RsPrefixOp, public exp: RsExpression) {
            super(span, ann);
        }
    }

    export class RsArrayLit extends RsExpression {
        public serialize() {
            return this._toAeson("ArrayLit", [this.members.serialize()], AesonCtor.WITH_CTOR);
        }

        constructor(public span: RsSrcSpan, public ann: Annotation[], public members: RsList<RsExpression>) {
            super(span, ann);
        }
    }

    export class RsCast extends RsExpression {
        public serialize() {
            return this._toAeson("Cast", [this.expression.serialize()], AesonCtor.WITH_CTOR);
        }

        constructor(public span: RsSrcSpan, public ann: Annotation[], public expression: RsExpression) {
            super(span, ann);
        }
    }


    //// Class Element

    export class RsClassElt extends RsAnnotatedAST {
        public serialize(): any {
            throw new Error("RsClassElt: child class should implement toJSON");
        }
    }

    export class RsConstructor extends RsClassElt {
        public serialize(): any {
            return this._toAeson("Constructor", [this.args.serialize(), this.body.serialize()], AesonCtor.WITH_CTOR);
        }

        constructor(public span: RsSrcSpan, public ann: Annotation[], public args: RsList<RsId>, public body: RsList<RsStatement>) {
            super(span, ann);
        }
    }

    export class RsMemberVarDecl extends RsClassElt {
        public serialize(): any {
            return this._toAeson("MemberVarDecl", [this.sta, this.name.serialize(), this.exp.serialize()], AesonCtor.WITH_CTOR);
        }

        constructor(public span: RsSrcSpan, public ann: Annotation[], public sta: boolean, public name: RsId, public exp: IRsMaybe<RsExpression>) {
            super(span, ann);
        }
    }

    export class RsMemberMethDecl extends RsClassElt {
        public serialize(): any {
            return this._toAeson("MemberMethDecl", [this.sta, this.name.serialize(), this.args.serialize(), this.body.serialize()], AesonCtor.WITH_CTOR);
        }

        constructor(public span: RsSrcSpan, public ann: Annotation[], public sta: boolean, public name: RsId, public args: RsList<RsId>, public body: RsList<RsStatement>) {
            super(span, ann);
        }
    }

    
    //// Statement

    export class RsStatement extends RsAnnotatedAST {
        public serialize(): any {
            throw new Error("RsStatement: child class should implement toJSON");
        }
    }

    export class RsEmptyStmt extends RsStatement implements IRsVarDeclLike {
        public serialize(): any {
            return this._toAeson("EmptyStmt", [], AesonCtor.WITH_CTOR);
        }

        constructor(public span: RsSrcSpan, public ann: Annotation[]) {
            super(span, ann);
        }
    }

    export class RsExprStmt extends RsStatement {
        public serialize(): any {
            return this._toAeson("ExprStmt", [this.exp.serialize()], AesonCtor.WITH_CTOR);
        }

        constructor(public span: RsSrcSpan, public ann: Annotation[], public exp: RsExpression) {
            super(span, ann);
        }
    }

    export class RsVarDeclStmt extends RsStatement {
        public serialize(): any {
            return this._toAeson("VarDeclStmt", [this.varDecls.serialize()], AesonCtor.WITH_CTOR);
        }

        constructor(public span: RsSrcSpan, public ann: Annotation[], public varDecls: RsList<RsVarDecl>) {
            super(span, ann);
        }
    }

    export class RsFunctionStmt extends RsStatement {
        public serialize() {
            return this._toAeson("FunctionStmt", [this.id.serialize(), this.args.serialize(), this.body.serialize()], AesonCtor.WITH_CTOR);
        }

        constructor(public span: RsSrcSpan, public ann: Annotation[], public id: RsId, public args: RsList<RsId>, public body: IRsMaybe<RsList<RsStatement>>) {
            super(span, ann);
        }
    }

    export class RsFuncCtorStmt extends RsStatement {
        public serialize() {
            return this._toAeson("FuncCtorStmt", [this.id.serialize(), this.args.serialize(), this.body.serialize()], AesonCtor.WITH_CTOR);
        }

        constructor(public span: RsSrcSpan, public ann: Annotation[], public id: RsId, public args: RsList<RsId>, public body: RsList<RsStatement>) {
            super(span, ann);
        }
    }

    export class RsFunctionAmbientDecl extends RsStatement {
        public serialize() {
            return this._toAeson("FuncAmbDecl", [this.id.serialize(), this.args.serialize()], AesonCtor.WITH_CTOR);
        }

        constructor(public span: RsSrcSpan, public ann: Annotation[], public id: RsId, public args: RsList<RsId>) {
            super(span, ann);
        }
    }

    export class RsFunctionOverload extends RsStatement {
        public serialize() {
            return this._toAeson("FuncOverload", [this.id.serialize(), this.args.serialize()], AesonCtor.WITH_CTOR);
        }

        constructor(public span: RsSrcSpan, public ann: Annotation[], public id: RsId, public args: RsList<RsId>) {
            super(span, ann);
        }
    }

    export class RsReturnStmt extends RsStatement {
        public serialize() {
            return this._toAeson("ReturnStmt", [this.expression.serialize()], AesonCtor.WITH_CTOR);
        }

        constructor(public span: RsSrcSpan, public ann: Annotation[], public expression: IRsMaybe<RsExpression>) {
            super(span, ann);
        }
    }

    export class RsBlockStmt extends RsStatement {
        public serialize() {
            return this._toAeson("BlockStmt", [this.body.serialize()], AesonCtor.WITH_CTOR);
        }

        constructor(public span: RsSrcSpan, public ann: Annotation[], public body: RsList<RsStatement>) {
            super(span, ann);
        }
    }

    export class RsClassStmt extends RsStatement {
        public serialize() {
            return this._toAeson("ClassStmt", [this.id.serialize(), this.body.serialize()], AesonCtor.WITH_CTOR);
        }

        constructor(public span: RsSrcSpan, public ann: Annotation[], public id: RsId, public body: RsList<RsClassElt>) {
            super(span, ann);
        }
    }

    export class RsEnumStmt extends RsStatement {
        public serialize() {
            return this._toAeson("EnumStmt", [this.id.serialize(), this.body.serialize()], AesonCtor.WITH_CTOR);
        }

        constructor(public span: RsSrcSpan, public ann: Annotation[], public id: RsId, public body: RsList<RsEnumElt>) {
            super(span, ann);
        }
    }

    export class RsWhileStmt extends RsStatement {
        public serialize() {
            return this._toAeson("WhileStmt", [this.exp.serialize(), this.body.serialize()], AesonCtor.WITH_CTOR);
        }

        constructor(public span: RsSrcSpan, public ann: Annotation[], public exp: RsExpression, public body: RsStatement) {
            super(span, ann);
        }
    }

    export class RsForInStmt extends RsStatement {
        public serialize() {
            return this._toAeson("ForInStmt", [this.init.serialize(), this.exp.serialize(), this.body.serialize()], AesonCtor.WITH_CTOR);
        }

        constructor(public span: RsSrcSpan, public ann: Annotation[], public init: RsForInInit, public exp: RsExpression, public body: RsStatement) {
            super(span, ann);
        }
    }

    export class RsForStmt extends RsStatement {
        public serialize() {
            return this._toAeson("ForStmt", [this.init.serialize(), this.test.serialize(), this.inc.serialize(), this.body.serialize()], AesonCtor.WITH_CTOR);
        }

        constructor(public span: RsSrcSpan, public ann: Annotation[], public init: RsForInit, public test: IRsMaybe<RsExpression>, public inc: IRsMaybe<RsExpression>, public body: RsStatement) {
            super(span, ann);
        }
    }

    export class RsIfStmt extends RsStatement {
        public serialize() {
            return this._toAeson("IfStmt", [this.cond.serialize(), this.s1.serialize(), this.s2.serialize()], AesonCtor.WITH_CTOR);
        }

        constructor(public span: RsSrcSpan, public ann: Annotation[], public cond: RsExpression, public s1: RsStatement, public s2: RsStatement) {
            super(span, ann);
        }
    }

    export class RsIfSingleStmt extends RsStatement {
        public serialize() {
            return this._toAeson("IfSingleStmt", [this.cond.serialize(), this.s.serialize()], AesonCtor.WITH_CTOR);
        }

        constructor(public span: RsSrcSpan, public ann: Annotation[], public cond: RsExpression, public s: RsStatement) {
            super(span, ann);
        }
    }

    export class RsThrowStatement extends RsStatement {
        public serialize() {
            return this._toAeson("ThrowStmt", [this.expression.serialize()], AesonCtor.WITH_CTOR);
        }

        constructor(public span: RsSrcSpan, public ann: Annotation[], public expression: RsExpression) {
            super(span, ann);
        }
    }

    export class RsModuleStmt extends RsStatement {
        public serialize() {
            return this._toAeson("ModuleStmt", [this.name.serialize(), this.body.serialize()], AesonCtor.WITH_CTOR);
        }

        constructor(public span: RsSrcSpan, public ann: Annotation[], public name: RsId, public body: RsList<RsStatement>) {
            super(span, ann);
        }
    }

    export class RsInterfaceStmt extends RsStatement implements IRsVarDeclLike {
        public serialize() {
            return this._toAeson("InterfaceStmt", [this.name.serialize()], AesonCtor.WITH_CTOR);
        }

        constructor(public span: RsSrcSpan, public ann: Annotation[], public name: RsId) {
            super(span, ann);
        }
    }


    //// Enum Element

    export class RsEnumElt extends RsAnnotatedAST {
        public serialize() {
            return this._toAeson("EnumElt", [this.name.serialize(), this.exp.serialize()], AesonCtor.NO_CTOR);
        }

        constructor(public span: RsSrcSpan, public ann: Annotation[], public name: RsId, public exp: RsExpression) {
            super(span, ann);
        }
    }

}
