import dotenv from 'dotenv';
dotenv.config({ path: './.env' });

async function run() {
  const key = process.env.NVIDIA_API_KEY;
  const start = Date.now();
  console.log('Sending test request to NVIDIA Nemotron...');

  const res = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + key,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning',
      messages: [
        { role: 'user', content: 'Say hello in JSON: {"message": "hello"}' }
      ],
      max_tokens: 100
    })
  });

  console.log('Response status:', res.status, 'in', Date.now() - start, 'ms');
  const data = await res.json();
  console.log('Response body:', JSON.stringify(data).substring(0, 300));
}
run().catch(console.error);
