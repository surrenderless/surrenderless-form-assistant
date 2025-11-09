import { hello, formScanner, formFiller, navigator, tools, task } from '@surrenderless/crew-js';

// console.log(hello()); // ❌ REMOVE THIS LINE

const crew = {
  agents: [formScanner, formFiller, navigator],
  tools,
  run: async (task) => {
    return { success: true, result: 'Simulated response' };
  },
};

export async function runCrew(params) {
  return await crew.run(params);
}

if (process.env.CREW_INPUT) {
  const params = JSON.parse(process.env.CREW_INPUT);
  runCrew(params)
    .then((res) => {
      console.log(JSON.stringify(res)); // ✅ ONLY valid output
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
