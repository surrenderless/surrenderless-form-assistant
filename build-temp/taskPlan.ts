export {}; // force module scope

import { formScanner, formFiller, navigator } from './agents.js';

const task = {
  objective: "Submit a USPS change of address form for user X",
  agents: [formScanner, formFiller, navigator],
  steps: [
    {
      agent: "Form Scanner",
      action: "extract all inputs and buttons from page"
    },
    {
      agent: "Form Filler",
      action: "map user data to inputs and fill them"
    },
    {
      agent: "Navigator",
      action: "find and click the Continue button"
    },
    {
      loop: true,
      until: "confirmation page or success message"
    }
  ]
};

export default task;
