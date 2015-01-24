/// <reference path="types.ts"/>
/// <reference path="factory.ts"/>
module ts {
    export module Locals {
        export function create(resolver: EmitResolver, context: Node, globals: Map<boolean>): Locals {
            return { resolver, context, globals, tempCount: 0 };
        }

        export function createUniqueIdentifier(locals: Locals, name?: string, globallyUnique?: boolean): Identifier {
            // when we generate a "global" unique identifier, we it to be unique in all contexts. This is 
            // to reduce the possibility of collisions when generating names used to rename symbols during emit
            // for downlevel rewrite of a catch block, and for future support for downlevel let/const.
            // We do this here rather than introduce new symbols into symbol table of the containing scope so that we don't 
            // make changes that would be compatible with incremental parse
            while (true) {
                if (name && locals.resolver.isUnknownIdentifier(locals.context, name)) {
                    break;
                }
                // _a .. _h, _j ... _z, _0, _1, ...
                name = "_" + (locals.tempCount < 25 ? String.fromCharCode(locals.tempCount + (locals.tempCount < 8 ? 0 : 1) + CharacterCodes.a) : locals.tempCount - 25);
                locals.tempCount++;
            }

            if (globallyUnique) {
                locals.globals[name] = true;
            }

            return Factory.createIdentifier(name);
        }

        export function recordVariable(locals: Locals, name: Identifier): void {
            if (!locals.variables) {
                locals.variables = [];
            }

            locals.variables.push(name);
        }

        export function ensureIdentifier(locals: Locals, expression: Expression, writeAssignment: (left: Identifier, right: Expression) => void): Identifier {
            if (expression.kind !== SyntaxKind.Identifier) {
                var local = createUniqueIdentifier(locals);
                writeAssignment(local, expression);
                return local;
            }
            return <Identifier>expression;
        }

        export function getValueOrDefault(locals: Locals, value: Expression, defaultValue: Expression, writeAssignment: (left: Identifier, right: Expression) => void): Expression {
            value = ensureIdentifier(locals, value, writeAssignment);
            var equalityExpression = Factory.createBinaryExpression(SyntaxKind.EqualsEqualsEqualsToken, value, Factory.createVoidZero());
            var conditionalExpression = Factory.createConditionalExpression(equalityExpression, defaultValue, value);
            return conditionalExpression;
        }
    }

    enum BlockAction {
        Open,
        Close,
    }

    enum BlockKind {
        Exception,
        ScriptBreak,
        Break,
        ScriptContinue,
        Continue,
        With
    }

    enum ExceptionBlockState {
        Try,
        Catch,
        Finally,
        Done
    }

    interface BlockScope {
        kind: BlockKind;
    }

    interface ExceptionBlock extends BlockScope {
        state: ExceptionBlockState;
        startLabel: Label;
        catchVariable?: Identifier;
        catchLabel?: Label;
        finallyLabel?: Label;
        endLabel: Label;
    }

    interface BreakBlock extends BlockScope {
        breakLabel: Label;
        labelText?: string[];
        requireLabel?: boolean;
    }

    interface ContinueBlock extends BreakBlock {
        continueLabel: Label;
    }

    interface WithBlock extends BlockScope {
        expression: Identifier;
        startLabel: Label;
        endLabel: Label;
    }
    
    export function createStatementsGenerator(locals: Locals): StatementsGenerator {
        return <StatementsGenerator>createCodeGenerator(locals, /*isStatementsGenerator*/ true);
    }

    export function createGeneratorFunctionGenerator(locals: Locals): FunctionGenerator {
        return <FunctionGenerator>createCodeGenerator(locals, /*isStatementsGenerator*/ false);
    }

    export function createAsyncFunctionGenerator(locals: Locals, promiseConstructor: EntityName): FunctionGenerator {
        return <FunctionGenerator>createCodeGenerator(locals, /*isStatementsGenerator*/ false, promiseConstructor);
    }

    function createCodeGenerator(locals: Locals, isStatementsGenerator: boolean, promiseConstructor?: EntityName): CodeGenerator {
        // locations
        var pendingLocation: TextRange;

        // locals/hoisted variables/hoisted functions
        var parameters: ParameterDeclaration[];
        var functions: FunctionDeclaration[];

        // blocks
        var blocks: BlockScope[];
        var blockStack: BlockScope[];
        var blockActions: BlockAction[];
        var blockOffsets: number[];
        var hasProtectedRegions: boolean;

        // labels
        var nextLabelId: number = 1;
        var labelNumbers: number[];
        var labels: number[];

        // operations
        var operations: OpCode[];
        var operationArguments: any[][];
        var operationLocations: TextRange[];

        var state: Identifier;

        function createStatementsGenerator(): StatementsGenerator {
            return {
                writeLocation,
                declareLocal,
                defineLabel,
                markLabel,
                emit,
                createUniqueIdentifier,
                buildStatements
            };
        }

        function createFunctionGenerator(): FunctionGenerator {
            return {
                writeLocation,
                addParameter,
                addVariable,
                addFunction,
                declareLocal,
                defineLabel,
                markLabel,
                beginExceptionBlock,
                beginCatchBlock,
                beginFinallyBlock,
                endExceptionBlock,
                beginWithBlock,
                endWithBlock,
                findBreakTarget,
                findContinueTarget,
                beginScriptContinueBlock,
                endScriptContinueBlock,
                beginScriptBreakBlock,
                endScriptBreakBlock,
                beginContinueBlock,
                endContinueBlock,
                beginBreakBlock,
                endBreakBlock,
                emit,
                createUniqueIdentifier,
                createInlineBreak,
                createInlineReturn,
                createResume,
                buildFunction
            };
        }

        return isStatementsGenerator ? createStatementsGenerator() : createFunctionGenerator();

        function declareLocal(name?: string, globallyUnique?: boolean): Identifier {
            var local = Locals.createUniqueIdentifier(locals, name, globallyUnique);
            Locals.recordVariable(locals, local);
            return local;
        }

        function createUniqueIdentifier(name?: string, globallyUnique?: boolean): Identifier {
            return Locals.createUniqueIdentifier(locals, name, globallyUnique);
        }

        function writeLocation(location: TextRange): void {
            pendingLocation = location;
        }

        function readLocation(): TextRange {
            var location = pendingLocation;
            pendingLocation = undefined;
            return location;
        }

        function addParameter(name: Identifier, flags?: NodeFlags): void {
            if (!parameters) parameters = [];
            parameters.push(Factory.createParameterDeclaration(name, undefined, readLocation(), flags));
        }

        function addVariable(name: Identifier, flags?: NodeFlags): void {
            Locals.recordVariable(locals, name);
        }

        function addFunction(func: FunctionDeclaration): void {
            if (!functions) {
                functions = [];
            }
            functions.push(func);
        }

        function defineLabel(): Label {
            if (!labels) labels = [];
            var label = nextLabelId++;
            labels[label] = -1;
            return <Label>label;
        }

        function markLabel(label: Label): void {
            Debug.assert(!!labels, "No labels were defined.");
            labels[<number>label] = operations ? operations.length : 0;
        }

        function beginWithBlock(expression: Identifier): void {
            var startLabel = defineLabel();
            var endLabel = defineLabel();
            markLabel(startLabel);
            beginBlock(<WithBlock>{
                kind: BlockKind.With,
                expression,
                startLabel,
                endLabel
            });
        }

        function endWithBlock(): void {
            Debug.assert(peekBlockKind() === BlockKind.With);
            var withBlock = endBlock<WithBlock>();
            markLabel(withBlock.endLabel);
        }

        function beginExceptionBlock(): Label {
            var startLabel = defineLabel();
            var endLabel = defineLabel();
            markLabel(startLabel);
            beginBlock(<ExceptionBlock>{
                kind: BlockKind.Exception,
                state: ExceptionBlockState.Try,
                startLabel,
                endLabel
            });
            hasProtectedRegions = true;
            return endLabel;
        }

        function beginCatchBlock(variable: Identifier): void {
            Debug.assert(peekBlockKind() === BlockKind.Exception);

            var exception = <ExceptionBlock>peekBlock();
            Debug.assert(exception.state < ExceptionBlockState.Catch);

            var endLabel = exception.endLabel;
            emit(OpCode.Break, endLabel);

            var catchLabel = defineLabel();
            markLabel(catchLabel);
            exception.state = ExceptionBlockState.Catch;
            exception.catchVariable = variable;
            exception.catchLabel = catchLabel;

            var state = getState();
            var errorProperty = Factory.createPropertyAccessExpression(state, Factory.createIdentifier("error"));
            var assignExpression = Factory.createBinaryExpression(SyntaxKind.EqualsToken, variable, errorProperty);
            emit(OpCode.Statement, assignExpression);
        }

        function beginFinallyBlock(): void {
            Debug.assert(peekBlockKind() === BlockKind.Exception);

            var exception = <ExceptionBlock>peekBlock();
            Debug.assert(exception.state < ExceptionBlockState.Finally);

            var state = exception.state;
            var endLabel = exception.endLabel;
            emit(OpCode.Break, endLabel);

            var finallyLabel = defineLabel();
            markLabel(finallyLabel);
            exception.state = ExceptionBlockState.Finally;
            exception.finallyLabel = finallyLabel;
        }

        function endExceptionBlock(): void {
            Debug.assert(peekBlockKind() === BlockKind.Exception);
            var exception = endBlock<ExceptionBlock>();
            var state = exception.state;
            if (state < ExceptionBlockState.Finally) {
                emit(OpCode.Break, exception.endLabel);
            }
            else {
                emit(OpCode.Endfinally);
            }

            markLabel(exception.endLabel);
            exception.state = ExceptionBlockState.Done;
        }

        function beginScriptContinueBlock(labelText: string[]): void {
            beginBlock<ContinueBlock>({
                kind: BlockKind.ScriptContinue,
                labelText: labelText,
                breakLabel: -1,
                continueLabel: -1
            });
        }

        function endScriptContinueBlock(): void {
            Debug.assert(peekBlockKind() === BlockKind.ScriptContinue);
            endBlock<ContinueBlock>();
        }

        function beginScriptBreakBlock(labelText: string[], requireLabel: boolean): void {
            beginBlock<BreakBlock>({
                kind: BlockKind.ScriptBreak,
                labelText: labelText,
                breakLabel: -1,
                requireLabel
            });
        }

        function endScriptBreakBlock(): void {
            Debug.assert(peekBlockKind() === BlockKind.ScriptBreak);
            endBlock<BreakBlock>();
        }

        function beginContinueBlock(continueLabel: Label, labelText: string[]): Label {
            var breakLabel = defineLabel();
            beginBlock<ContinueBlock>({
                kind: BlockKind.Continue,
                labelText: labelText,
                breakLabel: breakLabel,
                continueLabel: continueLabel
            });
            return breakLabel;
        }

        function endContinueBlock(): void {
            Debug.assert(peekBlockKind() === BlockKind.Continue);
            var block = endBlock<BreakBlock>();
            var breakLabel = block.breakLabel;
            if (breakLabel > 0) {
                markLabel(breakLabel);
            }
        }

        function beginBreakBlock(labelText: string[], requireLabel: boolean): Label {
            var breakLabel = defineLabel();
            beginBlock<BreakBlock>({
                kind: BlockKind.Break,
                labelText: labelText,
                breakLabel: breakLabel,
                requireLabel
            });
            return breakLabel;
        }

        function endBreakBlock(): void {
            Debug.assert(peekBlockKind() === BlockKind.Break);
            var block = endBlock<BreakBlock>();
            var breakLabel = block.breakLabel;
            if (breakLabel > 0) {
                markLabel(breakLabel);
            }
        }

        function beginBlock<TBlock extends BlockScope>(block: TBlock): number {
            if (!blocks) {
                blocks = [];
                blockActions = [];
                blockOffsets = [];
                blockStack = [];
            }

            var index = blockActions.length;
            blockActions[index] = BlockAction.Open;
            blockOffsets[index] = operations ? operations.length : 0;
            blocks[index] = block;
            blockStack.push(block);
            return index;
        }

        function endBlock<TBlock extends BlockScope>(): TBlock {
            Debug.assert(!!blocks, "beginBlock was never called.");
            var block = blockStack.pop();
            var index = blockActions.length;
            blockActions[index] = BlockAction.Close;
            blockOffsets[index] = operations ? operations.length : 0;
            blocks[index] = block;
            return <TBlock>block;
        }

        function peekBlock(back: number = 0): BlockScope {
            if (blocks) {
                return blockStack[blockStack.length - (1 + back)];
            }
        }

        function peekBlockKind(back: number = 0): BlockKind {
            var block = peekBlock(back);
            return block && block.kind;
        }

        function findBreakTarget(labelText?: string): Label {
            if (blocks) {
                for (var i = blockStack.length - 1; i >= 0; i--) {
                    var block = blockStack[i];
                    if (supportsBreak(block)) {
                        var breakBlock = <BreakBlock>block;
                        if ((!labelText && !breakBlock.requireLabel) || breakBlock.labelText && breakBlock.labelText.indexOf(labelText) !== -1) {
                            return breakBlock.breakLabel;
                        }
                    }
                }
            }

            return 0;
        }

        function findContinueTarget(labelText?: string): Label {
            if (blocks) {
                for (var i = blockStack.length - 1; i >= 0; i--) {
                    var block = blockStack[i];
                    if (supportsContinue(block)) {
                        var continueBreakBlock = <ContinueBlock>block;
                        if (!labelText || continueBreakBlock.labelText && continueBreakBlock.labelText.indexOf(labelText) !== -1) {
                            return continueBreakBlock.continueLabel;
                        }
                    }
                }
            }
        }

        function supportsBreak(block: BlockScope): boolean {
            switch (block.kind) {
                case BlockKind.ScriptBreak:
                case BlockKind.ScriptContinue:
                case BlockKind.Break:
                case BlockKind.Continue:
                    return true;
            }
            return false;
        }

        function supportsContinue(block: BlockScope): boolean {
            switch (block.kind) {
                case BlockKind.ScriptContinue:
                case BlockKind.Continue:
                    return true;
            }
            return false;
        }

        function reportUnexpectedOpCode(code: OpCode): void {
            var text: string;
            if (typeof (<any>ts).OpCode === "object") {
                text = (<any>ts).OpCode[code];
            }
            else {
                text = String(code);
            }

            Debug.fail("Unexpected OpCode: " + text);
        }

        function emit(code: OpCode, ...args: any[]): void {
            switch (code) {
                case OpCode.Assign:
                case OpCode.Statement:
                case OpCode.Return:
                case OpCode.Throw:
                    break;

                case OpCode.Break:
                case OpCode.BrFalse:
                case OpCode.BrTrue:
                case OpCode.Endfinally:
                case OpCode.Yield:
                case OpCode.YieldStar:
                    if (!isStatementsGenerator) {
                        break;
                    }

                default:
                    reportUnexpectedOpCode(code);
                    return;
            }

            var location = readLocation();
            if (code === OpCode.Statement) {
                var node = args[0];
                if (!node) {
                    return;
                }
            }

            if (!operations) {
                operations = [];
                operationArguments = [];
                operationLocations = [];
            }

            if (!labels) {
                // mark entry point
                markLabel(defineLabel());
            }

            var operationIndex = operations.length;
            operations[operationIndex] = code;
            operationArguments[operationIndex] = args;
            operationLocations[operationIndex] = location;
        }

        function createLabel(label: Label): GeneratedLabel {
            if (!labelNumbers) labelNumbers = [];
            return Factory.createGeneratedLabel(label, labelNumbers);
        }

        function createInlineBreak(label: Label): ReturnStatement {
            var instruction = Factory.createNumericLiteral('3 /*break*/');
            var returnExpression = Factory.createArrayLiteralExpression([instruction, createLabel(label)]);
            return Factory.createReturnStatement(returnExpression, readLocation());
        }

        function createInlineReturn(expression: Expression): ReturnStatement {
            var instruction = Factory.createNumericLiteral('3 /*return*/');
            if (expression) {
                var returnExpression = Factory.createArrayLiteralExpression([instruction, expression]);
            } else {
                var returnExpression = Factory.createArrayLiteralExpression([instruction]);
            }
            return Factory.createReturnStatement(returnExpression, readLocation());
        }

        function createResume(): LeftHandSideExpression {
            var state = getState();
            return Factory.createPropertyAccessExpression(state, Factory.createIdentifier("sent"));
        }

        function getState(): Identifier {
            if (!state) {
                state = createUniqueIdentifier("_state");
            }
            return state;
        }

        function buildFunction(kind: SyntaxKind, name: DeclarationName, location?: TextRange, flags?: NodeFlags, modifiers?: ModifiersArray): FunctionLikeDeclaration {
            var statements: Statement[] = [];
            statements = buildHoistedFunctionDeclarations(statements);
            var generatorStatements = buildStatements(/*forceReturn*/ true);
            var generatorFunctionBody = Factory.createBlock(generatorStatements);
            var generatorFunction = Factory.createFunctionExpression(/*name*/ undefined, generatorFunctionBody, [Factory.createParameterDeclaration(getState())]);
            var generatorExpression = Factory.createCallExpression(Factory.createIdentifier("__generator"), [generatorFunction]);
            if (promiseConstructor) {
                var resolve = createUniqueIdentifier("_resolve");
                var promiseConstructorExpression = Factory.getExpressionForEntityName(promiseConstructor);
                var awaiterExpression = Factory.createCallExpression(Factory.createIdentifier("__awaiter"), [generatorExpression]);
                var resolveExpression = Factory.createCallExpression(resolve, [awaiterExpression]);
                var promiseFunctionBody = Factory.createBlock([Factory.createExpressionStatement(resolveExpression)]);
                var promiseFunction = Factory.createFunctionExpression(/*name*/ undefined, promiseFunctionBody, [Factory.createParameterDeclaration(resolve)]);
                var newPromiseExpression = Factory.createNewExpression(promiseConstructorExpression, [promiseFunction]);
                var returnStatement = Factory.createReturnStatement(newPromiseExpression);
                statements.push(returnStatement);
            } else {
                var returnStatement = Factory.createReturnStatement(generatorExpression);
                statements.push(returnStatement);
            }

            var body = Factory.createBlock(Factory.createNodeArray<Statement>(statements));
            var node: FunctionLikeDeclaration;
            switch (kind) {
                case SyntaxKind.FunctionDeclaration:
                    return Factory.createFunctionDeclaration(<Identifier>name, body, parameters, location, flags, modifiers);
                case SyntaxKind.MethodDeclaration:
                    return Factory.createMethodDeclaration(name, body, parameters, location, flags, modifiers);
                case SyntaxKind.GetAccessor:
                    return Factory.createGetAccessor(name, body, parameters, location, flags, modifiers);
                case SyntaxKind.FunctionExpression:
                    return Factory.createFunctionExpression(<Identifier>name, body, parameters, location, flags, modifiers);
                case SyntaxKind.ArrowFunction:
                    return Factory.createArrowFunction(body, parameters, location, flags, modifiers);
                default:
                    reportUnexpectedNode(node);
                    return node;
            }
        }
        
        function buildHoistedFunctionDeclarations(statements: Statement[]): Statement[] {
            if (functions) {
                statements = statements.concat(functions);
            }
            return statements;
        }

        function buildStatements(forceReturn?: boolean): Statement[] {
            var blockIndex: number = 0;
            var labelNumber: number = 0;
            var lastOperationWasAbrupt = false;
            var lastOperationWasCompletion = false;
            var clauses: CaseClause[];
            var statements: Statement[];
            var exceptionBlockStack: ExceptionBlock[];
            var currentExceptionBlock: ExceptionBlock;
            var withBlockStack: WithBlock[];

            if (hasProtectedRegions) {
                initializeProtectedRegions();
            }

            if (operations) {
                for (var operationIndex = 0; operationIndex < operations.length; operationIndex++) {
                    writeOperation(
                        operations[operationIndex],
                        operationArguments[operationIndex],
                        operationLocations[operationIndex]);
                }
            }

            flushFinalLabel();

            if (clauses) {
                var state = getState();
                var labelExpression = Factory.createPropertyAccessExpression(state, Factory.createIdentifier("label"));
                var switchStatement = Factory.createSwitchStatement(labelExpression, clauses);
                return [switchStatement];
            }

            if (statements) {
                return statements;
            }

            return [];

            function initializeProtectedRegions(): void {
                var trysProperty = Factory.createPropertyAccessExpression(getState(), Factory.createIdentifier("trys"));
                var trysArray = Factory.createArrayLiteralExpression([]);
                var assignTrys = Factory.createBinaryExpression(SyntaxKind.EqualsToken, trysProperty, trysArray);
                writeStatement(assignTrys);
                flushLabel();
            }

            function flushLabel(): void {
                if (!statements) {
                    return;
                }

                appendLabel(/*markLabelEnd*/ !lastOperationWasAbrupt);

                lastOperationWasAbrupt = false;
                lastOperationWasCompletion = false;
                labelNumber++;
            }

            function flushFinalLabel(): void {
                if (!lastOperationWasCompletion && forceReturn) {
                    tryEnterLabel();
                    writeReturn();
                }

                if (statements && clauses) {
                    appendLabel(/*markLabelEnd*/ false);
                }
            }

            function appendLabel(markLabelEnd: boolean): void {
                if (!clauses) {
                    clauses = [];
                }

                if (statements) {
                    if (withBlockStack) {
                        for (var i = withBlockStack.length - 1; i >= 0; i--) {
                            var withBlock = withBlockStack[i];
                            statements = [Factory.createWithStatement(withBlock.expression, Factory.createBlock(statements))];
                        }
                    }

                    if (currentExceptionBlock) {
                        var startLabel = createLabel(currentExceptionBlock.startLabel);
                        var endLabel = createLabel(currentExceptionBlock.endLabel);
                        var catchLabel: Expression;
                        if (currentExceptionBlock.catchLabel > 0) {
                            catchLabel = createLabel(currentExceptionBlock.catchLabel);
                        }
                        else {
                            catchLabel = Factory.createOmittedExpression();
                        }

                        var finallyLabel: Expression;
                        if (currentExceptionBlock.finallyLabel > 0) {
                            finallyLabel = createLabel(currentExceptionBlock.finallyLabel);
                        }
                        else {
                            finallyLabel = Factory.createOmittedExpression();
                        }

                        var labelsArray = Factory.createArrayLiteralExpression([startLabel, catchLabel, finallyLabel, endLabel]);
                        var trysProperty = Factory.createPropertyAccessExpression(getState(), Factory.createIdentifier("trys"));
                        var pushMethod = Factory.createPropertyAccessExpression(trysProperty, Factory.createIdentifier("push"));
                        var callExpression = Factory.createCallExpression(pushMethod, [labelsArray]);
                        statements.unshift(Factory.createExpressionStatement(callExpression));
                        currentExceptionBlock = undefined;
                    }

                    if (markLabelEnd) {
                        var nextLabelNumberExpression = Factory.createNumericLiteral(labelNumber + 1);
                        var labelProperty = Factory.createPropertyAccessExpression(getState(), Factory.createIdentifier("label"));
                        var labelAssign = Factory.createBinaryExpression(SyntaxKind.EqualsToken, labelProperty, nextLabelNumberExpression);
                        statements.push(Factory.createExpressionStatement(labelAssign));
                    }
                }

                var labelNumberExpression = Factory.createNumericLiteral(labelNumber);
                var clause = Factory.createCaseClause(labelNumberExpression, statements || []);
                clauses.push(clause);
                statements = undefined;
            }
            
            function tryEnterLabel(): void {
                if (!labels) {
                    return;
                }

                var isLabel: boolean = false;
                for (var label = 0; label < labels.length; label++) {
                    if (labels[label] === operationIndex) {
                        flushLabel();
                        if (!labelNumbers) {
                            labelNumbers = [];
                        }
                        labelNumbers[label] = labelNumber;
                    }
                }
            }

            function tryEnterOrLeaveBlock(): void {
                if (blocks) {
                    for (; blockIndex < blockActions.length && blockOffsets[blockIndex] <= operationIndex; blockIndex++) {
                        var block = blocks[blockIndex];
                        var blockAction = blockActions[blockIndex];
                        if (blockAction === BlockAction.Open && block.kind === BlockKind.Exception) {
                            var exceptionBlock = <ExceptionBlock>block;
                            if (!exceptionBlockStack) {
                                exceptionBlockStack = [];
                            }
                            exceptionBlockStack.push(currentExceptionBlock);
                            currentExceptionBlock = exceptionBlock;
                        }
                        else if (blockAction === BlockAction.Close && block.kind === BlockKind.Exception) {
                            currentExceptionBlock = exceptionBlockStack.pop();
                        }
                        else if (blockAction === BlockAction.Open && block.kind === BlockKind.With) {
                            var withBlock = <WithBlock>block;
                            if (!withBlockStack) {
                                withBlockStack = [];
                            }
                            withBlockStack.push(withBlock);
                        }
                        else if (blockAction === BlockAction.Close && block.kind === BlockKind.With) {
                            withBlockStack.pop();
                        }
                    }
                }
            }

            // operations
            function writeOperation(operation: OpCode, operationArguments: any[], operationLocation: TextRange): void {
                tryEnterLabel();
                tryEnterOrLeaveBlock();

                // early termination, nothing else to process in this label
                if (lastOperationWasAbrupt) {
                    return;
                }

                lastOperationWasAbrupt = false;
                lastOperationWasCompletion = false;
                switch (operation) {
                    case OpCode.Statement: return writeStatement(<Node>operationArguments[0]);
                    case OpCode.Assign: return writeAssign(<Expression>operationArguments[0], <Expression>operationArguments[1], operationLocation);
                    case OpCode.Break: return writeBreak(<Label>operationArguments[0], operationLocation);
                    case OpCode.BrTrue: return writeBrTrue(<Label>operationArguments[0], <Expression>operationArguments[1], operationLocation);
                    case OpCode.BrFalse: return writeBrFalse(<Label>operationArguments[0], <Expression>operationArguments[1], operationLocation);
                    case OpCode.YieldStar: return writeYieldStar(<Expression>operationArguments[0], operationLocation);
                    case OpCode.Yield: return writeYield(<Expression>operationArguments[0], operationLocation);
                    case OpCode.Return: return writeReturn(<Expression>operationArguments[0], operationLocation);
                    case OpCode.Throw: return writeThrow(<Expression>operationArguments[0], operationLocation);
                    case OpCode.Endfinally: return writeEndfinally();
                }
            }

            function writeStatement(node: Node): void {
                if (isExpression(node)) {
                    node = Factory.createExpressionStatement(<Expression>node);
                }

                if (!statements) {
                    statements = [];
                }

                statements.push(<Statement>node);
            }

            function writeAssign(left: Expression, right: Expression, operationLocation?: TextRange): void {
                var assignExpression = Factory.createBinaryExpression(SyntaxKind.EqualsToken, left, right, operationLocation);
                writeStatement(assignExpression);
            }

            function writeBreak(label: Label, operationLocation?: TextRange): void {
                lastOperationWasAbrupt = true;
                var instruction = Factory.createNumericLiteral('3 /*break*/');
                var returnExpression = Factory.createArrayLiteralExpression([instruction, createLabel(label)]);
                var returnStatement = Factory.createReturnStatement(returnExpression, operationLocation);
                writeStatement(returnStatement);
            }

            function writeBrTrue(label: Label, condition: Expression, operationLocation?: TextRange): void {
                var instruction = Factory.createNumericLiteral('3 /*break*/');
                var returnExpression = Factory.createArrayLiteralExpression([instruction, createLabel(label)]);
                var returnStatement = Factory.createReturnStatement(returnExpression, operationLocation);
                var ifStatement = Factory.createIfStatement(condition, returnStatement);
                writeStatement(ifStatement);
            }

            function writeBrFalse(label: Label, condition: Expression, operationLocation?: TextRange): void {
                var instruction = Factory.createNumericLiteral('3 /*break*/');
                var returnExpression = Factory.createArrayLiteralExpression([instruction, createLabel(label)]);
                var returnStatement = Factory.createReturnStatement(returnExpression, operationLocation);
                var parenExpression = Factory.createParenthesizedExpression(condition);
                var notExpression = Factory.createPrefixUnaryExpression(SyntaxKind.ExclamationToken, parenExpression);
                var ifStatement = Factory.createIfStatement(notExpression, returnStatement);
                writeStatement(ifStatement);
            }

            function writeYield(expression: Expression, operationLocation?: TextRange): void {
                lastOperationWasAbrupt = true;
                var elements: Expression[] = [Factory.createNumericLiteral('4 /*yield*/')];
                if (expression) {
                    elements.push(expression);
                }
                var returnExpression = Factory.createArrayLiteralExpression(elements);
                var returnStatement = Factory.createReturnStatement(returnExpression, operationLocation);
                writeStatement(returnStatement);
            }

            function writeYieldStar(expression: Expression, operationLocation?: TextRange): void {
                lastOperationWasAbrupt = true;
                var elements: Expression[] = [Factory.createNumericLiteral('5 /*yield**/')];
                if (expression) {
                    elements.push(expression);
                }
                var returnExpression = Factory.createArrayLiteralExpression(elements);
                var returnStatement = Factory.createReturnStatement(returnExpression, operationLocation);
                writeStatement(returnStatement);
            }

            function writeReturn(expression?: Expression, operationLocation?: TextRange): void {
                lastOperationWasAbrupt = true;
                lastOperationWasCompletion = true;
                var elements: Expression[] = [Factory.createNumericLiteral('2 /*return*/')];
                if (expression) {
                    elements.push(expression);
                }
                var returnExpression = Factory.createArrayLiteralExpression(elements);
                var returnStatement = Factory.createReturnStatement(returnExpression, operationLocation);
                writeStatement(returnStatement);
            }

            function writeThrow(expression: Expression, operationLocation?: TextRange): void {
                lastOperationWasAbrupt = true;
                lastOperationWasCompletion = true;
                var throwStatement = Factory.createThrowStatement(expression, operationLocation);
                writeStatement(throwStatement);
            }

            function writeEndfinally(): void {
                lastOperationWasAbrupt = true;
                var instruction = Factory.createNumericLiteral('6 /*endfinally*/');
                var returnExpression = Factory.createArrayLiteralExpression([instruction]);
                var returnStatement = Factory.createReturnStatement(returnExpression);
                writeStatement(returnStatement);
            }
        }
    }
}