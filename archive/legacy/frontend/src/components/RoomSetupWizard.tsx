import React, { useState } from "react";
import DehumidifierSetupStep from "./DehumidifierSetupStep";

const RoomSetupWizard: React.FC = () => {
  const [step, setStep] = useState(1);

  return (
    <div>
      <h1>Room Setup Wizard</h1>
      {step === 1 && (
        <div>
          <h2>Step 1: Room Details</h2>
          {/* Room details form here */}
          <button onClick={() => setStep(2)}>Next</button>
        </div>
      )}
      {step === 2 && (
        <div>
          <h2>Step 2: Dehumidifier Setup</h2>
          <DehumidifierSetupStep />
          <button onClick={() => setStep(1)}>Back</button>
          <button onClick={() => setStep(3)}>Next</button>
        </div>
      )}
      {step === 3 && (
        <div>
          <h2>Step 3: Review</h2>
          {/* Review summary here */}
          <button onClick={() => setStep(2)}>Back</button>
          <button>Finish</button>
        </div>
      )}
    </div>
  );
};

export default RoomSetupWizard;
