/* First-lot browser regression. Offline simulation only; no equipment is contacted. */
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const output = path.resolve(__dirname, '../../verification/incidents');
const url = pathToFileURL(path.join(__dirname, 'index.html')).href;
const results = [];
const pass = (name, evidence = {}) => {
  results.push({ name, status: 'PASS', evidence });
  console.log('PASS: ' + name);
};
const nav = (page, label) => page.locator('.sidebar').getByRole('button', { name: label, exact: true }).click();
const status = page => page.getByTestId('incident-status');
async function report(page, buttonName = 'Exporter cet incident') {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: buttonName, exact: true }).click();
  const download = await pending;
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
async function openHeavyIncident(page) {
  await nav(page, 'Ma maison');
  await page.getByRole('button', { name: 'Gros téléchargement', exact: true }).click();
  await nav(page, 'Incidents');
  await page.locator('.ic-detail').waitFor({ timeout: 12000 });
  await status(page).waitFor();
}
async function main() {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1080 }, reducedMotion: 'reduce', acceptDownloads: true });
  const page = await context.newPage();
  const errors = [], remote = [];
  page.setDefaultTimeout(9000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('request', request => { if (/^https?:/.test(request.url())) remote.push(request.url()); });
  await context.route(/^https?:/, route => route.abort());
  try {
    await page.goto(url);
    await page.getByRole('button', { name: 'Ne pas faire la visite' }).click();
    await openHeavyIncident(page);
    assert.equal(await page.getByTestId('active-source').getAttribute('data-source'), 'household');
    assert.match(await page.getByTestId('active-source').innerText(), /simul/i);
    const initial = await report(page);
    assert.equal(initial.latest.mode, 'simulation');
    assert.ok(initial.incidents.length > 0);
    const initialCase = initial.incidents[0];
    assert.ok(initialCase.before);
    assert.notEqual(initialCase.status, 'resolved');
    pass('Gros téléchargement crée un incident basé sur les mesures du foyer', { status: initialCase.status });

    await page.getByRole('button', { name: 'Mettre les mesures en pause', exact: true }).click();
    for (const name of ['Diagnostic', 'Assistant']) {
      await nav(page, name);
      assert.equal(await page.getByTestId('active-source').getAttribute('data-source'), 'household');
      assert.equal(await page.getByLabel('Source des mesures', { exact: true }).inputValue(), 'household');
    }
    await page.getByRole('textbox', { name: 'Votre question' }).fill('Pourquoi ma connexion ralentit ?');
    await page.getByRole('button', { name: 'Envoyer la question', exact: true }).click();
    await page.locator('.bubble.assistant').last().waitFor();
    assert.ok((await page.locator('.bubble.assistant').last().innerText()).includes(initialCase.title));
    pass('Diagnostic et Assistant conservent la source active du foyer');

    await nav(page, 'Incidents');
    await page.getByRole('button', { name: 'Appliquer et vérifier', exact: true }).click();
    const modal = page.getByRole('dialog', { name: 'Appliquer cette correction simulée ?' });
    await modal.getByRole('button', { name: 'Annuler', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: 'Reprendre les mesures communes', exact: true }).count(), 1);
    const cancelled = (await report(page)).incidents[0];
    assert.equal(cancelled.status, initialCase.status);
    assert.equal(cancelled.after ?? null, null);
    await nav(page, 'Ma maison');
    assert.equal(await page.getByLabel('Limite de PlayStation 5 de Koffi').inputValue(), 'none');
    pass('Annuler la correction ne modifie ni la console ni la pause');

    await page.getByLabel('Accès au foyer (démo)').selectOption('visitor');
    await nav(page, 'Incidents');
    for (const name of ['Appliquer et vérifier', 'Vérifier sans modifier']) {
      assert.equal(await page.getByRole('button', { name, exact: true }).isDisabled(), true);
    }
    assert.equal(await page.getByTestId('incident-resume').isDisabled(), true);
    pass('Les actions du dossier sont réservées au propriétaire : correction, vérification et reprise');
    await nav(page, 'Ma maison');
    await page.getByLabel('Accès au foyer (démo)').selectOption('owner');

    await nav(page, 'Incidents');
    await page.getByRole('button', { name: 'Appliquer et vérifier', exact: true }).click();
    await modal.getByRole('button', { name: 'Confirmer et vérifier', exact: true }).click();
    await page.getByRole('button', { name: 'Mettre les mesures en pause', exact: true }).click();
    const pausedCount = Number(await page.getByTestId('incident-progress').getAttribute('data-count'));
    await page.waitForTimeout(6200);
    assert.notEqual(await status(page).getAttribute('data-status'), 'resolved');
    assert.equal(Number(await page.getByTestId('incident-progress').getAttribute('data-count')), pausedCount);
    const pausedReport = (await report(page)).incidents[0];
    assert.equal(pausedReport.after ?? null, null);
    pass('La pause ne produit aucun faux échantillon ni résolution fantôme', { pausedCount });

    await nav(page, 'Ma maison');
    assert.equal(await page.getByLabel('Limite de PlayStation 5 de Koffi').inputValue(), '10');
    await nav(page, 'Incidents');
    await page.getByRole('button', { name: 'Reprendre les mesures communes', exact: true }).click();
    await page.locator('[data-testid="incident-status"][data-status="resolved"]').waitFor({ timeout: 12000 });
    const verified = await report(page), verifiedCase = verified.incidents[0];
    assert.equal(verified.latest.mode, 'simulation');
    assert.equal(verifiedCase.mode, 'simulation');
    assert.equal(verifiedCase.status, 'resolved');
    assert.ok(verifiedCase.after);
    assert.notDeepEqual(verifiedCase.before, verifiedCase.after);
    assert.equal(verifiedCase.measurements.length, 5);
    assert.equal(new Set(verifiedCase.measurements.map(frame => frame.id)).size, 5);
    assert.ok(verifiedCase.measurements.every(frame => frame.at > verifiedCase.before.at));
    assert.ok(verifiedCase.after.metrics.topSharePct < verifiedCase.before.metrics.topSharePct);
    assert.equal(verifiedCase.after.metrics.opticalDbm, null, 'Household measurements cannot invent an optical signal');
    assert.match(verified.notice, /simul/i);
    assert.match(verified.notice, /aucun|réel/i);
    pass('Correction confirmée puis cinq mesures fraîches produisent une preuve avant/après', { status: verifiedCase.status });

    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: 1080 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Incidents must not overflow at ' + width);
      await page.screenshot({ path: path.join(output, 'incidents-' + width + '.png'), fullPage: true });
    }
    pass('Centre incidents sans débordement à 320, 390 et 1440 pixels');

    await page.getByRole('button', { name: 'Vos données & les limites' }).click();
    const globalReport = await report(page, 'Télécharger mon rapport');
    assert.equal(globalReport.simulation, true);
    assert.equal(globalReport.sourceDiagnostic, 'household');
    assert.equal(globalReport.sourceCommune.origin, 'household');
    assert.deepEqual(globalReport.mesures, globalReport.sourceCommune.metrics);
    assert.equal(globalReport.mesures.opticalDbm, null);
    assert.equal(globalReport.historique.length, 0);
    assert.equal(globalReport.foyer.devices.find(device => device.id === 'console').limit, 10);
    pass('Le rapport global garde la source foyer sans ajouter de mesures optiques ou d’historique de ligne');

    await page.reload();
    await nav(page, 'Incidents');
    await page.locator('.ic-detail[data-archived="true"]').waitFor();
    const restoredCase = (await report(page)).incidents.find(incident => incident.id === verifiedCase.id);
    assert.ok(restoredCase);
    assert.equal(restoredCase.archived, true);
    const reapply = page.getByRole('button', { name: 'Appliquer et vérifier', exact: true });
    assert.ok(!(await reapply.count()) || await reapply.isDisabled());
    pass('Le rechargement conserve la preuve en historique sans prétendre vérifier la nouvelle session');

    await openHeavyIncident(page);
    const openItem = page.locator('.ic-list-item').filter({ has: page.locator('[data-status="open"]') }).first();
    await openItem.waitFor({ timeout: 10000 });
    await openItem.click();
    await page.getByRole('button', { name: 'Vérifier sans modifier', exact: true }).click();
    await page.getByRole('button', { name: 'Mettre les mesures en pause', exact: true }).click();
    const interruptedId = await page.locator('.ic-detail').getAttribute('data-incident-id');
    await page.reload();
    await nav(page, 'Incidents');
    await page.locator('.ic-list-item').filter({ has: page.locator('[data-status="unverifiable"]') }).first().click();
    const interrupted = (await report(page)).incidents.find(incident => incident.id === interruptedId);
    assert.ok(interrupted);
    assert.equal(interrupted.status, 'unverifiable');
    assert.equal(interrupted.archived, true);
    assert.equal(interrupted.after, null);
    pass('Une vérification interrompue par rechargement reste non vérifiable, sans preuve fabriquée');

    await openHeavyIncident(page);
    await openItem.waitFor({ timeout: 10000 });
    await openItem.click();
    await page.getByRole('button', { name: 'Vérifier sans modifier', exact: true }).click();
    await page.getByLabel('Source des mesures', { exact: true }).selectOption('line');
    await page.locator('[data-testid="incident-status"][data-status="unverifiable"]').waitFor();
    const changedSource = (await report(page)).incidents[0];
    assert.equal(changedSource.after, null);
    assert.match(changedSource.reason, /source/i);
    assert.equal(await page.getByRole('button', { name: 'Vérifier sans modifier', exact: true }).isDisabled(), true);
    pass('Changer de source interrompt la vérification : aucune comparaison de deux réseaux');

    await page.getByRole('button', { name: 'Vos données & les limites' }).click();
    await page.getByRole('button', { name: 'Effacer mes données de session', exact: true }).click();
    await page.getByRole('button', { name: 'Effacer la session', exact: true }).click();
    await nav(page, 'Incidents');
    await page.getByRole('heading', { name: 'Aucun incident enregistré pour le moment', exact: true }).waitFor();
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('fg-codex-incidents-v1'))?.incidents?.length || 0), 0);
    pass('L’effacement utilisateur supprime aussi les incidents persistés et leurs preuves');

    assert.deepEqual(errors, [], 'No browser errors');
    assert.deepEqual(remote, [], 'No remote network calls');
    pass('Aucune erreur navigateur et aucun appel externe');
  } catch (error) {
    results.push({ name: 'Browser regression', status: 'FAIL', error: error.stack });
    await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
    throw error;
  } finally {
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ results, errors, remote }, null, 2));
    await context.close();
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
