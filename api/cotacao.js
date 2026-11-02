// Vercel Serverless Function: busca cotações de Mato Grosso por categoria.
// Fontes (nessa ordem): IMEA (boi gordo por município), Datagro (vaca gorda e reposição por categoria), Scot Consultoria (reserva).
// Uso: /api/cotacao?mun=Barra%20do%20Gar%C3%A7as
const NA = 'https://www.noticiasagricolas.com.br/cotacoes/boi-gordo/';
const SCOT = 'https://www.scotconsultoria.com.br/cotacoes/';
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '');
const limpa = h => h.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const num = s => parseFloat(String(s).replace(/\./g, '').replace(',', '.'));
const ehNum = c => /^[+-]?\d{1,3}(\.\d{3})*,\d{1,2}$/.test(c);

function linhas(html) {
  const out = []; const tr = /<tr[\s\S]*?<\/tr>/gi; let m;
  while ((m = tr.exec(html))) {
    const cel = []; const td = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi; let x;
    while ((x = td.exec(m[0]))) cel.push(limpa(x[1]));
    if (cel.length > 1) out.push(cel);
  }
  return out;
}
function dataDe(html) {
  const t = limpa(html), a = /Fechamento:?\s*(\d{2}\/\d{2}\/\d{4})/i.exec(t) || /(\d{2}\/\d{2}\/\d{4})/.exec(t);
  return a ? a[1] : null;
}
// primeira linha (a mais recente) cuja 1ª coluna é exatamente o nome pedido; devolve os números da linha
function achaLinha(html, nome, min, max) {
  const alvo = norm(nome), l = linhas(html).find(c => norm(c[0]) === alvo);
  if (!l) return null;
  const v = l.slice(1).filter(ehNum).map(num);
  const bons = v.filter(x => x >= min && x <= max);
  return bons.length ? { v, bons } : null;
}
async function baixa(url) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 9000);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { 'user-agent': 'Mozilla/5.0 (compatible; MeuRebanho/1.0)', 'accept-language': 'pt-BR' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.text();
  } finally { clearTimeout(t); }
}

// ---- fontes ----
async function imeaBoi(mun) {
  const h = await baixa(NA + 'boi-a-vista-imea'), r = achaLinha(h, mun, 150, 900);
  if (!r) throw new Error('município "' + mun + '" não está na tabela do IMEA');
  return { v: r.bons[0], fonte: 'IMEA, ' + mun, data: dataDe(h) };
}
async function datagroVaca() {
  const h = await baixa(NA + 'indicador-da-vaca'), r = achaLinha(h, 'Mato Grosso', 150, 900);
  if (!r) throw new Error('Mato Grosso não está na tabela da vaca');
  return { v: r.bons[0], fonte: 'Datagro, Mato Grosso', data: dataDe(h) };
}
async function datagroRepos(sexo) {
  const h = await baixa(NA + (sexo === 'M' ? 'reposicao-nelore-macho' : 'reposicao-nelore-femea')), l = linhas(h).find(c => norm(c[0]) === 'matogrosso');
  if (!l) throw new Error('Mato Grosso não está na tabela de reposição');
  const v = l.slice(1).filter(ehNum).map(num);
  if (v.length < 4 || v.some(x => x < 3 || x > 60)) throw new Error('tabela de reposição fora do formato esperado');
  return { v, data: dataDe(h), fonte: 'Datagro, Mato Grosso' };
}
async function scot(pagina, praca) {
  const h = await baixa(SCOT + pagina + '/'), r = achaLinha(h, praca, 150, 900);
  if (!r) throw new Error('praça não encontrada na Scot');
  const d = /(\d{2}\/\d{2}\/\d{4})/.exec(limpa(h));
  return { v: r.bons[0], fonte: 'Scot Consultoria, ' + praca, data: d ? d[1] : null };
}

async function tenta(out, chave, fns) {
  const erros = [];
  for (const f of fns) {
    try { out[chave] = await f(); return; } catch (e) { erros.push((e.name === 'AbortError' ? 'demorou demais' : e.message)); }
  }
  out.erros.push(chave + ': ' + erros.join(' / '));
}

module.exports = async (req, res) => {
  const mun = String((req.query && req.query.mun) || 'Barra do Garças').slice(0, 40);
  const praca = String((req.query && req.query.praca) || 'MT Sudeste').slice(0, 30);
  const out = { ok: false, mun, erros: [] };
  await Promise.all([
    tenta(out, 'boi', [() => imeaBoi(mun), () => scot('boi-gordo', praca)]),
    tenta(out, 'vaca', [datagroVaca, () => scot('vaca-gorda', praca)]),
    tenta(out, 'novilha', [() => scot('novilha', praca)]),
    tenta(out, 'reposM', [() => datagroRepos('M')]),
    tenta(out, 'reposF', [() => datagroRepos('F')])
  ]);
  if (out.reposM) { const v = out.reposM.v; out.curvaM = [{ kg: 190, p: v[0], nome: 'Desmama' }, { kg: 240, p: v[1], nome: 'Bezerro' }, { kg: 300, p: v[2], nome: 'Garrote' }, { kg: 380, p: v[3], nome: 'Boi magro' }]; }
  if (out.reposF) { const v = out.reposF.v; out.curvaF = [{ kg: 180, p: v[0], nome: 'Desmama' }, { kg: 210, p: v[1], nome: 'Bezerra' }, { kg: 300, p: v[2], nome: 'Novilha' }, { kg: 380, p: v[3], nome: 'Vaca magra' }]; }
  out.ok = !!(out.boi || out.vaca || out.novilha || out.curvaM || out.curvaF);
  res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');
  res.status(200).json(out);
};
module.exports._t = { linhas, achaLinha, dataDe, norm };
