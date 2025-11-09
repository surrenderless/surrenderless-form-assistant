import { spawn } from 'child_process';
import path from 'path';

type RunCrewParams = {
  url: string;
  userData: {
    name: string;
    address: string;
    email: string;
  };
  logStep?: (step: string) => void;
};

export async function runCrewBridge(params: RunCrewParams) {
  const { logStep = () => {} } = params;

  return new Promise((resolve, reject) => {
    logStep('🧠 Starting CrewBridge...');

    const child = spawn('node', ['scripts/runCrewWrapper.mjs'], {
      env: {
        ...process.env,
        CREW_INPUT: JSON.stringify(params),
      },
      stdio: ['pipe', 'pipe', 'inherit'],
    });

    let output = '';

    child.stdout.on('data', (data) => {
      const str = data.toString();
      output += str;

      // Log each chunk if desired
      logStep(`📤 Output: ${str.trim()}`);
    });

    child.on('close', () => {
      try {
        const result = JSON.parse(output);
        logStep('✅ CrewBridge finished successfully');
        resolve(result);
      } catch (err) {
        logStep('❌ CrewBridge failed to parse output');
        reject(err);
      }
    });
  });
}
