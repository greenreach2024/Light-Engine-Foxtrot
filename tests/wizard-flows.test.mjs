import test from 'node:test';
import assert from 'node:assert/strict';
import { app, __resetWizardSystemForTests } from '../server-charlie.js';

let server;
let baseUrl;

function listen(appInstance) {
  return new Promise((resolve) => {
    const instance = appInstance.listen(0, () => {
      const { port } = instance.address();
      resolve({ instance, port });
    });
  });
}

test.before(async () => {
  const { instance, port } = await listen(app);
  server = instance;
  baseUrl = `http://127.0.0.1:${port}`;
});

test.after(async () => {
  if (server) {
    await new Promise((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
});

async function httpPost(path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const json = await response.json();
  return { status: response.status, body: json };
}

async function httpGet(path) {
  const response = await fetch(`${baseUrl}${path}`);
  const json = await response.json();
  return { status: response.status, body: json };
}

function extractRecommendedWizard(suggestions, wizardId) {
  for (const suggestion of suggestions) {
    const match = suggestion.recommendedWizards.find((wizard) => wizard.id === wizardId);
    if (match) {
      return match;
    }
  }
  return null;
}

test('MQTT discovery populates broker defaults and next step context', async () => {
  __resetWizardSystemForTests();

  const mqttDevice = {
    ip: '10.0.0.5',
    hostname: 'mqtt-broker',
    type: 'mqtt',
    services: [{ name: 'mqtt', port: 1883 }]
  };

  const discoveryResponse = await httpPost('/discovery/suggest-wizards', { devices: [mqttDevice] });
  assert.equal(discoveryResponse.status, 200);
  assert.ok(discoveryResponse.body.success);
  const mqttSuggestion = extractRecommendedWizard(discoveryResponse.body.suggestions, 'mqtt-setup');
  assert.ok(mqttSuggestion, 'Expected MQTT wizard suggestion');
  assert.equal(mqttSuggestion.discoveryDefaults['broker-connection'].host, 'mqtt-broker');

  const wizardResponse = await httpGet('/setup/wizards/mqtt-setup');
  assert.equal(wizardResponse.status, 200);
  const brokerStep = wizardResponse.body.steps.find((step) => step.id === 'broker-connection');
  assert.equal(brokerStep.fields.find((field) => field.name === 'host').default, 'mqtt-broker');

  const brokerDefaults = wizardResponse.body.state.discoveryDefaults['broker-connection'];
  const executeResponse = await httpPost('/setup/wizards/mqtt-setup/execute-validated', {
    stepId: 'broker-connection',
    data: {
      host: brokerDefaults.host,
      port: brokerDefaults.port,
      secure: brokerDefaults.secure,
      username: '',
      password: ''
    }
  });

  assert.equal(executeResponse.status, 200);
  assert.ok(executeResponse.body.result.success);
  assert.equal(executeResponse.body.result.nextStep, 'topic-discovery');
  assert.equal(executeResponse.body.result.nextStepDefaults.baseTopic, 'mqtt-broker/#');
  assert.equal(executeResponse.body.result.discoveryDefaults['broker-connection'].host, 'mqtt-broker');
});

test('Kasa discovery reuses device discovery and assignment factories', async () => {
  __resetWizardSystemForTests();

  const kasaDevice = {
    ip: '10.0.0.20',
    hostname: 'kasa-plug',
    type: 'kasa',
    services: ['tplink']
  };

  const discoveryResponse = await httpPost('/discovery/suggest-wizards', { devices: [kasaDevice] });
  assert.equal(discoveryResponse.status, 200);
  assert.ok(discoveryResponse.body.success);
  const kasaSuggestion = extractRecommendedWizard(discoveryResponse.body.suggestions, 'kasa-setup');
  assert.ok(kasaSuggestion, 'Expected Kasa wizard suggestion');
  assert.equal(kasaSuggestion.discoveryDefaults['device-discovery'].targetIP, '10.0.0.20');

  const wizardResponse = await httpGet('/setup/wizards/kasa-setup');
  assert.equal(wizardResponse.status, 200);
  const discoveryStep = wizardResponse.body.steps.find((step) => step.id === 'device-discovery');
  assert.equal(discoveryStep.fields.find((field) => field.name === 'targetIP').default, '10.0.0.20');

  const discoveryDefaults = wizardResponse.body.state.discoveryDefaults['device-discovery'];
  const executeResponse = await httpPost('/setup/wizards/kasa-setup/execute-validated', {
    stepId: 'device-discovery',
    data: {
      discoveryTimeout: discoveryDefaults.discoveryTimeout,
      targetIP: discoveryDefaults.targetIP
    }
  });

  assert.equal(executeResponse.status, 200);
  assert.ok(executeResponse.body.result.success);
  assert.equal(executeResponse.body.result.nextStep, 'device-configuration');
  assert.equal(executeResponse.body.result.nextStepDefaults.alias, 'kasa-plug');
});

test('SwitchBot wizard maintains discovery context across steps', async () => {
  __resetWizardSystemForTests();

  const switchbotDevice = {
    ip: '10.0.0.40',
    hostname: 'switchbot-hub',
    type: 'switchbot',
    services: []
  };

  const discoveryResponse = await httpPost('/discovery/suggest-wizards', { devices: [switchbotDevice] });
  assert.equal(discoveryResponse.status, 200);
  assert.ok(discoveryResponse.body.success);
  const switchbotSuggestion = extractRecommendedWizard(discoveryResponse.body.suggestions, 'switchbot-setup');
  assert.ok(switchbotSuggestion, 'Expected SwitchBot wizard suggestion');
  assert.deepEqual(switchbotSuggestion.discoveryDefaults, {});

  const wizardResponse = await httpGet('/setup/wizards/switchbot-setup');
  assert.equal(wizardResponse.status, 200);
  assert.equal(wizardResponse.body.state.discoveryContext.devices[0].hostname, 'switchbot-hub');

  const executeResponse = await httpPost('/setup/wizards/switchbot-setup/execute-validated', {
    stepId: 'api-credentials',
    data: {
      token: 'demo-token',
      secret: 'demo-secret'
    }
  });

  assert.equal(executeResponse.status, 200);
  assert.ok(executeResponse.body.result.success);
  assert.equal(executeResponse.body.result.nextStep, 'device-discovery');
  assert.deepEqual(executeResponse.body.result.discoveryContext.devices[0].hostname, 'switchbot-hub');
});
