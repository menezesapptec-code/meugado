// Vercel Serverless Function: lista de municípios de um estado (fonte: IBGE).
// Uso: /api/municipios?uf=MT
module.exports = async (req, res) => {
  const uf = String((req.query && req.query.uf) || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2);
  if (uf.length !== 2) return res.status(400).json({ ok: false, erro: 'uf inválida' });
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 9000);
  try {
    const r = await fetch('https://servicos.ibge.gov.br/api/v1/localidades/estados/' + uf + '/municipios', { signal: ctl.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    const nomes = j.map(m => m.nome).filter(Boolean).sort((a, b) => a.localeCompare(b, 'pt-BR'));
    if (!nomes.length) throw new Error('lista vazia');
    res.setHeader('Cache-Control', 's-maxage=2592000, stale-while-revalidate=7776000');
    res.status(200).json({ ok: true, uf, nomes });
  } catch (e) {
    res.status(200).json({ ok: false, uf, erro: e.name === 'AbortError' ? 'demorou demais' : e.message });
  } finally { clearTimeout(t); }
};
