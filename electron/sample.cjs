// Generates a deterministic "Financial sample"-style dataset (same shape as the
// classic Power BI sample) so the app has data to play with out of the box.
const fs = require('fs');
const path = require('path');

function rng(seed) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

const segments = ['Government', 'Midmarket', 'Channel Partners', 'Enterprise', 'Small Business'];
const countries = ['Canada', 'Germany', 'France', 'Mexico', 'United States of America', 'Italy'];
const products = [
  ['Carretera', 3], ['Montana', 5], ['Paseo', 10], ['Velo', 120], ['VTT', 250], ['Amarilla', 260],
];
const salePrices = { Government: [7, 20, 350], Midmarket: [15], 'Channel Partners': [12], Enterprise: [125], 'Small Business': [300] };
const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function ensureSample(dir) {
  const file = path.join(dir, 'Financials.csv');
  if (fs.existsSync(file)) return file;
  const r = rng(42);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const rows = [['Segment', 'Country', 'Product', 'Discount Band', 'Units Sold', 'Manufacturing Price', 'Sale Price',
    'Gross Sales', 'Discounts', 'Sales', 'COGS', 'Profit', 'Date', 'Month Number', 'Month Name', 'Year'].join(',')];
  for (let i = 0; i < 1400; i++) {
    const segment = pick(segments);
    const country = pick(countries);
    const [product, mfg] = pick(products);
    const sale = pick(salePrices[segment]);
    const units = Math.round(200 + r() * 4300) + 0.5 * Math.round(r());
    const bandRoll = r();
    const band = bandRoll < 0.15 ? 'None' : bandRoll < 0.45 ? 'Low' : bandRoll < 0.8 ? 'Medium' : 'High';
    const discPct = { None: 0, Low: 0.02, Medium: 0.07, High: 0.12 }[band];
    const gross = units * sale;
    const discounts = gross * discPct;
    const sales = gross - discounts;
    const cogsFactor = segment === 'Enterprise' ? 1.04 : segment === 'Small Business' ? 0.83 : segment === 'Channel Partners' ? 0.25 : segment === 'Midmarket' ? 0.66 : 0.72;
    const cogs = units * sale * cogsFactor * (0.85 + r() * 0.3);
    const profit = sales - cogs;
    const year = r() < 0.25 ? 2013 : 2014;
    const month = year === 2013 ? 9 + Math.floor(r() * 4) : 1 + Math.floor(r() * 12);
    const date = `${year}-${String(month).padStart(2, '0')}-01`;
    rows.push([segment, country, product, band, units, mfg, sale, gross.toFixed(2), discounts.toFixed(2),
      sales.toFixed(2), cogs.toFixed(2), profit.toFixed(2), date, month, monthNames[month - 1], year].join(','));
  }
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, rows.join('\n') + '\n');
  return file;
}

// Dimension tables for the star-schema demo (phase 3: relationships).
function ensureDims(dir) {
  const products = path.join(dir, 'Products.csv');
  if (!fs.existsSync(products)) {
    fs.writeFileSync(products, [
      'Product,Category,Launch Year,List Price',
      'Carretera,Road,2009,20', 'Montana,Mountain,2010,30', 'Paseo,City,2011,45',
      'Velo,Road,2012,135', 'VTT,Mountain,2013,280', 'Amarilla,City,2014,295',
    ].join('\n') + '\n');
  }
  const countries = path.join(dir, 'Countries.csv');
  if (!fs.existsSync(countries)) {
    fs.writeFileSync(countries, [
      'Country,Continent,Currency,Population (M)',
      'Canada,North America,CAD,38.9', 'Germany,Europe,EUR,83.2', 'France,Europe,EUR,68.0',
      'Mexico,North America,MXN,128.5', 'United States of America,North America,USD,333.3',
      'Italy,Europe,EUR,58.9', 'Spain,Europe,EUR,48.0',
    ].join('\n') + '\n');
  }
  return { products, countries };
}

module.exports = { ensureSample, ensureDims };
