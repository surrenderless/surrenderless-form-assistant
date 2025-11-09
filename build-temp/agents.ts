export {}; // force module scope

export const formScanner = {
  name: "Form Scanner",
  goal: "Understand the current form and extract all fields and buttons",
  tools: ["DOMParser"],
};

export const formFiller = {
  name: "Form Filler",
  goal: "Match user profile data with form fields and populate them correctly",
  tools: ["BrowserControl"],
};

export const navigator = {
  name: "Navigator",
  goal: "Click the right button to proceed to the next step",
  tools: ["BrowserControl"],
};