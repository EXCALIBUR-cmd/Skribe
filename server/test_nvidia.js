import dotenv from 'dotenv';
dotenv.config({ path: './.env' });

async function run() {
  const key = process.env.NVIDIA_API_KEY;
  const res = await fetch('https://integrate.api.nvidia.com/v1/models', {
    headers: { 'Authorization': 'Bearer ' + key }
  });
  const data = await res.json();
  const models = data.data.map(m => m.id);
  console.log('All models matching regex:');
  console.log(models.filter(m => /nemotron|vision|omni|vl/i.test(m)));
  console.log('Is nvidia/nemotron-3-nano-omni-30b-a3b-reasoning in the list?');
  console.log(models.includes('nvidia/nemotron-3-nano-omni-30b-a3b-reasoning'));
}
run().catch(console.error);
