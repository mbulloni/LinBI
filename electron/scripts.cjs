// Python and R visuals, like Power BI Desktop: the visual's fields become `dataset`
// (pandas DataFrame / R data.frame, duplicate rows removed), the script draws with
// matplotlib / an R graphics device, the image is returned as a PNG data URL.
// Python: LINBI_PYTHON, the project's .venv-pbix, ~/.config/linbi/pbix-venv, else python3. R: Rscript.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile, execFileSync } = require('child_process');
const { app } = require('electron');

const TIMEOUT = 60_000;

let chosen = null;
/** First interpreter that has pandas and matplotlib (checked once). */
function python() {
  if (process.env.LINBI_PYTHON) return process.env.LINBI_PYTHON;
  if (chosen) return chosen;
  const candidates = [path.join(__dirname, '..', '.venv-pbix', 'bin', 'python'), path.join(app.getPath('userData'), 'pbix-venv', 'bin', 'python'), 'python3']
    .filter((p) => p === 'python3' || fs.existsSync(p));
  for (const p of candidates) {
    try { execFileSync(p, ['-I', '-c', 'import pandas, matplotlib'], { stdio: 'ignore', timeout: 20000 }); chosen = p; return p; } catch { /* next */ }
  }
  // None ready: point the install hint at LinBI's own environment when there is one.
  return candidates.find((p) => p.includes('pbix-venv')) ?? candidates[0] ?? 'python3';
}

const PY = `import sys, os
import pandas
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot
dataset = pandas.read_csv(sys.argv[1], keep_default_na=True)
dataset = dataset.drop_duplicates()
__w, __h = int(sys.argv[3]), int(sys.argv[4])
matplotlib.pyplot.rcParams['figure.figsize'] = (__w / 100, __h / 100)
matplotlib.pyplot.rcParams['figure.dpi'] = 100
with open(sys.argv[2], encoding='utf-8') as __f:
    __code = __f.read()
exec(compile(__code, 'script.py', 'exec'), {'__name__': '__main__', 'dataset': dataset, 'pandas': pandas})
__fig = matplotlib.pyplot.gcf()
__fig.set_size_inches(__w / 100, __h / 100)
__fig.savefig(sys.argv[5], dpi=100)
`;

const R = `args <- commandArgs(trailingOnly = TRUE)
dataset <- read.csv(args[1], check.names = FALSE, stringsAsFactors = FALSE)
dataset <- unique(dataset)
png(args[5], width = as.integer(args[3]), height = as.integer(args[4]))
source(args[2], local = TRUE)
invisible(dev.off())
`;

const setup = (lang) => (lang === 'r'
  ? 'R non è installato: installarlo (es. sudo apt install r-base) e riprovare.'
  : `Servono Python con pandas e matplotlib: ${python()} -m pip install pandas matplotlib`);

/** Runs a Python or R visual script; resolves to a data:image/png URL. */
function run(lang, script, csv, width, height) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'linbi-script-'));
  const files = { data: path.join(dir, 'dataset.csv'), script: path.join(dir, lang === 'r' ? 'script.R' : 'script.py'), runner: path.join(dir, lang === 'r' ? 'run.R' : 'run.py'), out: path.join(dir, 'out.png') };
  fs.writeFileSync(files.data, csv);
  fs.writeFileSync(files.script, script);
  fs.writeFileSync(files.runner, lang === 'r' ? R : PY);
  const w = String(Math.max(50, Math.round(width))), h = String(Math.max(50, Math.round(height)));
  const [cmd, args] = lang === 'r' ? ['Rscript', [files.runner]] : [python(), ['-I', files.runner]];
  return new Promise((resolve, reject) => {
    execFile(cmd, [...args, files.data, files.script, w, h, files.out], { cwd: dir, timeout: TIMEOUT, maxBuffer: 8 * 1024 * 1024 }, (err, _stdout, stderr) => {
      try {
        if (err) {
          if (err.code === 'ENOENT' || /No module named '(pandas|matplotlib)'/.test(stderr)) return reject(new Error(setup(lang)));
          if (err.killed) return reject(new Error(`Lo script ha superato il tempo massimo (${TIMEOUT / 1000} s).`));
          const lines = String(stderr || err.message).trim().split('\n');
          return reject(new Error(lines.slice(-6).join('\n')));
        }
        if (!fs.existsSync(files.out)) return reject(new Error('Lo script non ha prodotto alcuna immagine.'));
        resolve('data:image/png;base64,' + fs.readFileSync(files.out).toString('base64'));
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  });
}

module.exports = { run };
