---------------- MODULE DispatchReturnFourForms ----------------
EXTENDS Naturals

CONSTANT ReturnRule

VARIABLES form, pc, armResult, functionResult, armCount, functionCount

vars == <<form, pc, armResult, functionResult, armCount, functionCount>>
Forms == {"match", "do match", "switch", "do switch"}
ValueForms == {"match", "switch"}
IsValue == form \in ValueForms

Init ==
    /\ form \in Forms
    /\ pc = "start"
    /\ armResult = -1
    /\ functionResult = -1
    /\ armCount = 0
    /\ functionCount = 0

SelectArm ==
    /\ pc = "start"
    /\ pc' = "selected"
    /\ UNCHANGED <<form, armResult, functionResult, armCount, functionCount>>

DeliverToArm ==
    IF ReturnRule = "safe"
    THEN IsValue
    ELSE ReturnRule = "force_arm"

ReturnFromSelectedArm ==
    /\ pc = "selected"
    /\ IF DeliverToArm
       THEN /\ pc' = "continue"
            /\ armResult' = 42
            /\ armCount' = armCount + 1
            /\ UNCHANGED <<form, functionResult, functionCount>>
       ELSE /\ pc' = "done"
            /\ functionResult' = 42
            /\ functionCount' = functionCount + 1
            /\ UNCHANGED <<form, armResult, armCount>>

ReturnFromEnclosingFunction ==
    /\ pc = "continue"
    /\ pc' = "done"
    /\ functionResult' = armResult + 1
    /\ functionCount' = functionCount + 1
    /\ UNCHANGED <<form, armResult, armCount>>

Next == SelectArm \/ ReturnFromSelectedArm \/ ReturnFromEnclosingFunction
Spec == Init /\ [][Next]_vars

TypeOK ==
    /\ form \in Forms
    /\ pc \in {"start", "selected", "continue", "done"}
    /\ armResult \in {-1, 42}
    /\ functionResult \in {-1, 42, 43}
    /\ armCount \in 0..1
    /\ functionCount \in 0..1

NoEarlyFunctionReturn ==
    (IsValue /\ pc = "continue") => functionResult = -1

ProceduralNeverCreatesArmResult ==
    ~IsValue => armCount = 0

CorrectTerminalReturn ==
    (pc = "done") =>
        (IF IsValue THEN functionResult = 43 ELSE functionResult = 42)

ExactlyOnce ==
    /\ armCount <= 1
    /\ functionCount <= 1

====
