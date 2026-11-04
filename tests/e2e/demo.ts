/**
 * Made-up data for the screenshots: a hep-th/new listing of invented papers (rendered into the
 * saved arXiv page, so the page around it is arXiv's own) and an invented researcher, served by a
 * fake INSPIRE. Every title, author, abstract and identifier here is fictional; the arXiv numbers
 * (9xxxx) are above any that arXiv has issued.
 */

interface DemoPaper {
  id: string;
  title: string;
  authors: string[];
  /** Primary category, then the other categories. */
  subjects: string[];
  comments?: string;
  abstract: string;
  section: 'new' | 'cross' | 'replacement';
  version?: number;
}

const NEW: Omit<DemoPaper, 'section'>[] = [
  {
    id: '2611.90412',
    title: 'Super-Schwarzian fluctuations of rotating near-BPS black holes in five-dimensional gauged supergravity',
    authors: ['Ilse Varga', 'Tomás Echeverri'],
    subjects: ['hep-th', 'gr-qc'],
    comments: '34 pages, 3 figures',
    abstract:
      'We compute the one-loop partition function of near-BPS rotating black holes in five-dimensional minimal gauged supergravity. In the near-horizon region the dynamics reduces to $\\mathcal{N}=2$ super-Schwarzian quantum mechanics, whose exact density of states has a gap of order the inverse entropy above the BPS bound. We match the resulting logarithmic corrections to the large-$N$ superconformal index of the dual field theory, and show that the gap closes for an arbitrarily small rotation away from the supersymmetric locus.',
  },
  {
    id: '2611.90437',
    title: 'Islands without replicas: a Lorentzian derivation of the Page curve',
    authors: ['Priya Raghunathan', 'Jonas Weidmann', 'Ilse Varga'],
    subjects: ['hep-th', 'gr-qc', 'quant-ph'],
    comments: '21 pages, 5 figures',
    abstract:
      'The island formula for the entropy of Hawking radiation is usually derived from Euclidean replica wormholes. We give a derivation that stays in Lorentzian signature throughout, based on the real-time path integral for the reduced density matrix of the radiation. Islands appear as complex saddles whose contribution dominates after the Page time. We apply the construction to evaporating black holes in two-dimensional dilaton gravity and recover the Page curve together with its first quantum correction.',
  },
  {
    id: '2611.90455',
    title: 'Curvature corrections to the stress-tensor four-point function from crossing and localisation',
    authors: ['Mei-Ling Hsu', 'Kwame Asante'],
    subjects: ['hep-th'],
    comments: '48 pages, 9 figures, 2 tables',
    abstract:
      "We combine the analytic bootstrap with localisation constraints to determine the four-point function of the stress-tensor multiplet in $\\mathcal{N}=4$ super Yang-Mills theory at large 't Hooft coupling. Crossing symmetry and the known OPE data of protected operators fix the first two curvature corrections to the supergravity result. We extract the anomalous dimensions of double-trace operators and compare them with the flat-space limit of the type IIB string amplitude.",
  },
  {
    id: '2611.90468',
    title: 'Coulomb-dressed charged operators on the lattice',
    authors: ['Sofia Laaksonen', 'Rafael Quintana'],
    subjects: ['hep-th', 'hep-lat'],
    abstract:
      'We propose a lattice construction of gauge-invariant charged operators in $SU(N)$ Yang-Mills theory, in which the charge is dressed by a Coulomb-like cloud of link variables. We prove that the dressed operators have finite norm in the continuum limit and compute their two-point functions in Monte Carlo simulations at three lattice spacings. The results support a confining interpretation of the dressing at long distances.',
  },
  {
    id: '2611.90503',
    title: 'A two-boundary chord configuration and the ramp of double-scaled SYK',
    authors: ['Yuki Tanabe', 'Elif Karaca'],
    subjects: ['hep-th', 'cond-mat.str-el'],
    comments: '27 pages, 6 figures',
    abstract:
      'We study the spectral form factor of the double-scaled Sachdev-Ye-Kitaev model using its chord diagram description. At late times the dominant contribution comes from a two-boundary configuration that we identify with a wormhole saddle of the dual gravitational theory. The resulting ramp and plateau agree with random matrix theory, and we compute the leading non-perturbative corrections in the triple-scaled limit, where the model reduces to Jackiw-Teitelboim gravity.',
  },
  {
    id: '2611.90519',
    title: 'Aligned multi-axion quintessence and the weak gravity conjecture',
    authors: ['Noah Brandt', 'Dana Okafor'],
    subjects: ['hep-th', 'astro-ph.CO'],
    comments: '19 pages, 4 figures',
    abstract:
      'We analyse quintessence models in which dark energy is driven by several axions with aligned decay constants. Requiring consistency with the weak gravity conjecture for axions and with the refined de Sitter conjecture restricts the allowed field ranges and the equation of state today. We find that models compatible with current supernova and baryon acoustic oscillation data need at least three axions and predict $w_0 > -0.95$, within reach of upcoming surveys.',
  },
  {
    id: '2611.90542',
    title: 'Celestial chiral algebras from a twistor worldsheet model',
    authors: ['Lars Holmqvist', 'Chiara Benedetti'],
    subjects: ['hep-th', 'math-ph', 'math.MP'],
    comments: '32 pages',
    abstract:
      'We derive the tree-level celestial amplitudes of self-dual gravity from a worldsheet model in twistor space. The Mellin transform of its correlators organises into a chiral algebra on the celestial sphere whose generators are the soft graviton modes. We obtain closed formulas for all maximally helicity violating amplitudes and identify the deformation of the celestial algebra induced by the first non-self-dual vertex.',
  },
  {
    id: '2611.90560',
    title: 'Projective line operators in Chern-Simons-matter theories',
    authors: ['Ivan Petrović', 'Amara Nwosu'],
    subjects: ['hep-th', 'cond-mat.str-el'],
    abstract:
      'We construct non-invertible topological line operators in three-dimensional Chern-Simons theories coupled to fundamental matter. The lines arise from gauging a one-form symmetry on a codimension-one surface and act on monopole operators by projecting onto neutral sectors. We determine their fusion rules, discuss the implications for the infrared phases of these theories, and comment on large-$N$ bosonisation dualities.',
  },
  {
    id: '2611.90577',
    title: 'Saturation of holographic complexity in near-extremal throats',
    authors: ['Felix Lindqvist', 'Hana Novotná'],
    subjects: ['hep-th', 'gr-qc'],
    comments: '25 pages, 8 figures',
    abstract:
      'We compute the late-time growth of holographic complexity for Reissner-Nordström-AdS black holes using both the volume and the action proposals. Near extremality the growth rate is controlled by the throat region and reduces to the complexity of the dual Schwarzian theory. Quantum fluctuations of the throat saturate the growth at a time exponential in the entropy, consistent with the expected plateau of complexity in chaotic quantum systems.',
  },
  {
    id: '2611.90594',
    title: 'Cancellation of instanton superpotentials for monad bundles revisited',
    authors: ['Mateo Ruiz', 'Aiko Morimoto'],
    subjects: ['hep-th', 'math.AG'],
    abstract:
      'We compute worldsheet instanton contributions to the superpotential of heterotic compactifications on Calabi-Yau threefolds with vector bundles constructed as monads. Using the gauged linear sigma model we show that contributions from rational curves in a given homology class cancel for a large class of bundles, extending earlier vanishing theorems. We present examples where the cancellation fails and the bundle moduli are stabilised.',
  },
  {
    id: '2611.90611',
    title: 'Moduli-space localisation of late-time de Sitter correlators',
    authors: ['Omar Haddad', 'Leila Farahani'],
    subjects: ['hep-th', 'gr-qc'],
    abstract:
      'We propose scattering equations for late-time correlators of massive scalar fields in de Sitter space. The equations localise an integral over the moduli space of punctured spheres, as in flat space, but with a deformation that depends on the masses through the conformal dimensions $\\Delta_i$. We check the proposal against the known wavefunction coefficients at four and five points and discuss its flat-space limit.',
  },
  {
    id: '2611.90628',
    title: 'Fixed-area saddles with conical defects and the Hawking-Page transition of charged black holes',
    authors: ['Pablo Serrano', 'Ingrid Solberg'],
    subjects: ['hep-th', 'gr-qc'],
    comments: '30 pages, 4 figures',
    abstract:
      'We study Euclidean saddles of the gravitational path integral that contain conical defects, and show that they compute the Rényi entropies of black holes in a fixed-area ensemble. Summing over defect angles reproduces the canonical partition function and clarifies the role of off-shell geometries in the Gibbons-Hawking calculation. For charged black holes in AdS the defects shift the location of the Hawking-Page transition.',
  },
];

const CROSS: Omit<DemoPaper, 'section'>[] = [
  {
    id: '2611.90645',
    title: 'Logarithmic running of tidal responses in extremal Kerr-Newman throats',
    authors: ['Kenji Arakawa', 'Zara Whitfield'],
    subjects: ['gr-qc', 'hep-th'],
    comments: '15 pages, 2 figures',
    abstract:
      'We compute the static tidal Love numbers of extremal Kerr-Newman black holes in Einstein-Maxwell theory. Although the Love numbers vanish for non-extremal black holes, the extremal limit is singular: the near-horizon throat induces a logarithmic running of the tidal response. We relate the running to the conformal symmetry of the throat and discuss the prospects for observing it in near-extremal black holes.',
  },
  {
    id: '2611.90662',
    title: 'Operator growth and the thermalisation time of chaotic spin chains',
    authors: ['Teodor Ilić', 'Marisol Vega'],
    subjects: ['cond-mat.stat-mech', 'hep-th', 'quant-ph'],
    abstract:
      'We study the approach to equilibrium in chaotic spin chains by following the growth of operators under Heisenberg evolution. Combining exact diagonalisation with tensor-network simulations of chains of up to 60 sites, we show that local observables thermalise on a time scale set by the butterfly velocity. We compare with random circuit models and identify corrections due to energy conservation.',
  },
  {
    id: '2611.90679',
    title: '$U(1)$-covariant tensor-network codes on hyperbolic tilings',
    authors: ['Benedikt Auer', 'Nadia Rahman'],
    subjects: ['quant-ph', 'hep-th'],
    comments: '18 pages, 7 figures',
    abstract:
      'We construct quantum error-correcting codes from tensor networks on regular hyperbolic tilings that preserve a continuous $U(1)$ symmetry. The codes realise approximate versions of the Ryu-Takayanagi formula and of entanglement wedge reconstruction, with errors that decrease with the bond dimension. We show how the symmetry is reflected in a boundary current algebra and discuss the obstruction to exact error correction.',
  },
  {
    id: '2611.90696',
    title: 'Double Higgs production in vector-boson fusion at a 10 TeV muon collider: a detector-level study',
    authors: ['Samuel Achterberg', 'Clara Moreau'],
    subjects: ['hep-ph', 'hep-ex', 'hep-th'],
    comments: '22 pages, 11 figures',
    abstract:
      'We assess the sensitivity of a 10 TeV muon collider to the trilinear Higgs self-coupling through double Higgs production in vector-boson fusion. Including detector effects and the dominant backgrounds, we find that the coupling can be determined to about four percent. We interpret the result in the Standard Model effective field theory and show how it constrains models with an extended scalar sector.',
  },
  {
    id: '2611.90713',
    title: 'A rigorous Schwarzian measure on boundary curves of hyperbolic surfaces',
    authors: ['Viktor Hale', 'Rosa Lindgren'],
    subjects: ['math-ph', 'hep-th', 'math.MP', 'math.SP'],
    abstract:
      'We give a rigorous construction of Schwarzian quantum mechanics on the space of boundary curves of a hyperbolic surface with geodesic boundary. We prove that the partition function is the Weil-Petersson volume integrated against the Schwarzian density of states, as predicted by Jackiw-Teitelboim gravity, and establish the asymptotics of the spectral density at low energies.',
  },
  {
    id: '2611.90730',
    title: 'Pion-decay photons sharpen Hawking-emission bounds on light primordial black holes',
    authors: ['Henrik Dahl', 'Lucía Ortega'],
    subjects: ['astro-ph.HE', 'hep-ph', 'hep-th'],
    comments: '12 pages, 6 figures',
    abstract:
      'We update the constraints on the abundance of primordial black holes with masses between $10^{14}$ and $10^{17}$ g from their Hawking emission. We include the secondary photons from the decay of emitted pions and the effect of black hole spin, and fit the diffuse extragalactic gamma-ray background. The resulting bound improves earlier limits by a factor of two at the low-mass end.',
  },
  {
    id: '2611.90747',
    title: 'Quadratic quasinormal-mode couplings and ringdown memory',
    authors: ['Ruth Abendroth', 'Marco Felici'],
    subjects: ['gr-qc', 'hep-th'],
    comments: '40 pages',
    abstract:
      'We develop a gauge-invariant formalism for second-order perturbations of the Schwarzschild spacetime and use it to compute the nonlinear memory of gravitational waves produced in the ringdown of a binary merger. The memory is dominated by the quadratic coupling of the fundamental quadrupole mode and reaches a few percent of the linear signal for comparable-mass binaries.',
  },
];

const REPLACEMENTS: Omit<DemoPaper, 'section'>[] = [
  {
    id: '2608.91204',
    title: 'Polar terms of the elliptic genus and multi-centre black strings',
    authors: ['Elif Karaca', 'Ilse Varga'],
    subjects: ['hep-th'],
    comments: 'v2: references added, typos corrected; 29 pages',
    version: 2,
    abstract:
      'We count the microstates of supersymmetric black strings in AdS$_3\\times S^3\\times T^4$ using the elliptic genus of the dual two-dimensional superconformal field theory. A modular bootstrap of the elliptic genus at large central charge reproduces the Bekenstein-Hawking entropy and its leading logarithmic correction. The polar terms responsible for the growth are in one-to-one correspondence with multi-centre bound states in supergravity.',
  },
  {
    id: '2607.90381',
    title: 'Physics-informed neural networks for the dense QCD equation of state',
    authors: ['Jae-won Park', 'Freya Lund'],
    subjects: ['hep-ph', 'nucl-th', 'hep-th'],
    comments: 'v3: matches the published version',
    version: 3,
    abstract:
      'We reconstruct the equation of state of QCD at finite baryon chemical potential from lattice data at imaginary chemical potential with a physics-informed neural network. The network enforces thermodynamic consistency and causality, and uncertainties are estimated with an ensemble of networks. We find no evidence for a critical point below $\\mu_B/T = 3$ and provide a parametrisation for hydrodynamic simulations of heavy-ion collisions.',
  },
  {
    id: '2610.90154',
    title: 'Boundary gravitons in a finite Dirichlet box and the complex $T\\bar{T}$ spectrum',
    authors: ['Omar Haddad', 'Nils Ekström'],
    subjects: ['hep-th'],
    comments: 'v2: section 4 expanded',
    version: 2,
    abstract:
      'We revisit the correspondence between three-dimensional gravity with Dirichlet boundary conditions at a finite radius and the $T\\bar{T}$ deformation of the dual conformal field theory. Including the boundary graviton modes, we derive the deformed spectrum from the gravitational path integral on the solid torus, and show that the complex energies at high energy match a breakdown of the bulk boundary value problem.',
  },
  {
    id: '2609.90722',
    title: 'Anisotropic polarisation rotation from scaling axion-string networks',
    authors: ['Noah Brandt', 'Leila Farahani'],
    subjects: ['astro-ph.CO', 'hep-ph', 'hep-th'],
    version: 2,
    abstract:
      'We compute the rotation of the polarisation plane of cosmic microwave background photons induced by a network of axion strings with a scaling distribution. The anomaly coefficient of the axion-photon coupling fixes the rotation angle across each string, which leads to an anisotropic birefringence pattern. We forecast the sensitivity of next-generation CMB experiments to this signal.',
  },
  {
    id: '2610.90891',
    title: 'BPS plateaux in the spectral form factor of $\\mathcal{N}=2$ JT supergravity',
    authors: ['Yuki Tanabe', 'Aiko Morimoto'],
    subjects: ['hep-th', 'math-ph', 'math.MP'],
    comments: 'v2: 33 pages, minor corrections',
    version: 2,
    abstract:
      'We compute the spectral form factor of $\\mathcal{N}=1$ and $\\mathcal{N}=2$ Jackiw-Teitelboim supergravity beyond the double-trumpet approximation. Using the dual random matrix ensembles we determine the plateau and show that, for $\\mathcal{N}=2$, the BPS states give a constant contribution at all times. We interpret the result as a sum over wormhole geometries with fermionic moduli.',
  },
  {
    id: '2606.90513',
    title: 'Triality webs of brane brick models for toric fourfolds',
    authors: ['Mateo Ruiz'],
    subjects: ['hep-th', 'math.AG'],
    version: 2,
    abstract:
      'We study two-dimensional $\\mathcal{N}=(0,2)$ quiver gauge theories on D1-branes probing toric Calabi-Yau fourfolds, encoded in brane brick models. Triality acts on brane brick models by local moves, and we classify the resulting duality webs for all toric fourfolds with up to eight lattice points. We match the elliptic genera across each web.',
  },
  {
    id: '2605.90266',
    title: 'A lower bound on Kaluza-Klein decay rates in families of AdS vacua',
    authors: ['Chiara Benedetti'],
    subjects: ['hep-th'],
    comments: 'v3: published version, 14 pages',
    version: 3,
    abstract:
      'We discuss the anti-de Sitter distance conjecture for families of supersymmetric AdS vacua in type IIB string theory. Approaching the flat-space limit, towers of Kaluza-Klein modes become light at a rate fixed by the internal geometry, and we show that the exponent satisfies a universal lower bound.',
  },
];

export const DEMO_PAPERS: DemoPaper[] = [
  ...NEW.map((p) => ({ ...p, section: 'new' as const })),
  ...CROSS.map((p) => ({ ...p, section: 'cross' as const })),
  ...REPLACEMENTS.map((p) => ({ ...p, section: 'replacement' as const })),
];

/** An author on several of the papers, followed in the screenshots. */
export const DEMO_FOLLOWED = 'Ilse Varga';

const SUBJECT_NAMES: Record<string, string> = {
  'hep-th': 'High Energy Physics - Theory',
  'hep-ph': 'High Energy Physics - Phenomenology',
  'hep-ex': 'High Energy Physics - Experiment',
  'hep-lat': 'High Energy Physics - Lattice',
  'gr-qc': 'General Relativity and Quantum Cosmology',
  'quant-ph': 'Quantum Physics',
  'nucl-th': 'Nuclear Theory',
  'astro-ph.CO': 'Cosmology and Nongalactic Astrophysics',
  'astro-ph.HE': 'High Energy Astrophysical Phenomena',
  'cond-mat.str-el': 'Strongly Correlated Electrons',
  'cond-mat.stat-mech': 'Statistical Mechanics',
  'math-ph': 'Mathematical Physics',
  'math.MP': 'Mathematical Physics',
  'math.AG': 'Algebraic Geometry',
  'math.SP': 'Spectral Theory',
};

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** arXiv's author-search query, e.g. "Hsu,+M" for Mei-Ling Hsu. */
function authorQuery(name: string): string {
  const parts = name.split(' ');
  const surname = parts.pop()!;
  return [encodeURIComponent(surname) + ',', ...parts.map((p) => p[0])].join('+');
}

function renderEntry(p: DemoPaper, n: number): string {
  const archive = p.subjects[0]!.split('.')[0];
  const note =
    p.section === 'cross' ? `\n          (cross-list from ${p.subjects[0]})\n` : p.section === 'replacement' ? '\n          (replaced)\n' : '\n      ';
  const authors = p.authors
    .map((a) => `<a href="https://arxiv.org/search/${archive}?searchtype=author&amp;query=${authorQuery(a)}">${escape(a)}</a>`)
    .join(', ');
  const comments = p.comments
    ? `\n        <div class='list-comments mathjax'><span class='descriptor'>Comments:</span>\n          ${escape(p.comments)}\n        </div>\n`
    : '';
  const [primary, ...others] = p.subjects;
  const subject = (c: string) => `${SUBJECT_NAMES[c]} (${c})`;
  const subjects = [`<span class="primary-subject">${subject(primary!)}</span>`, ...others.map(subject)].join('; ');
  const v = p.version ?? 1;
  return `
    <dt>
      <a name='item${n}'>[${n}]</a>
      <a href ="/abs/${p.id}" title="Abstract" id="${p.id}">
        arXiv:${p.id}
      </a>${note}
        [<a href="/pdf/${p.id}" title="Download PDF" id="pdf-${p.id}" aria-labelledby="pdf-${p.id}">pdf</a>, <a href="https://arxiv.org/html/${p.id}v${v}" title="View HTML" id="html-${p.id}" aria-labelledby="html-${p.id}" rel="noopener noreferrer" target="_blank">html</a>, <a href="/format/${p.id}" title="Other formats" id="oth-${p.id}" aria-labelledby="oth-${p.id}">other</a>]
    </dt>
    <dd>
      <div class='meta'>
        <div class='list-title mathjax'><span class='descriptor'>Title:</span>
          ${escape(p.title)}
        </div>
        <div class='list-authors'>${authors}</div>
${comments}

        <div class='list-subjects'><span class='descriptor'>Subjects:</span>
          ${subjects}
        </div>

        <p class='mathjax'>
          ${escape(p.abstract)}
        </p>
      </div>
    </dd>`;
}

function replaceOnce(html: string, from: string | RegExp, to: string): string {
  const out = html.replace(from, to);
  if (out === html) throw new Error(`demo listing: the saved page no longer contains ${String(from)}`);
  return out;
}

/** The saved hep-th/new page with its entries swapped for the made-up ones. */
export function renderDemoListing(template: string): string {
  const sections = [
    ['new', 'New submissions'],
    ['cross', 'Cross submissions'],
    ['replacement', 'Replacement submissions'],
  ] as const;
  let n = 0;
  const firstItem: number[] = [];
  const dls = sections.map(([key, heading]) => {
    const papers = DEMO_PAPERS.filter((p) => p.section === key);
    firstItem.push(n + 1);
    const entries = papers.map((p) => renderEntry(p, ++n)).join('');
    return `      <dl id='articles'>\n    <h3>${heading} (showing ${papers.length} of ${papers.length} entries)</h3>\n\n${entries}\n</dl>`;
  });
  const start = template.indexOf("      <dl id='articles'>");
  const end = template.lastIndexOf('</dl>') + '</dl>'.length;
  if (start < 0 || end < start) throw new Error('demo listing: no entries found in the saved page');
  let html = template.slice(0, start) + dls.join('\n\n') + template.slice(end);
  html = replaceOnce(html, /Showing new listings for [^<]+/, 'Showing new listings for Wednesday, 4 November 2026');
  html = replaceOnce(html, /Total of \d+ entries/g, `Total of ${n} entries`);
  html = replaceOnce(html, /href="#item\d+">Cross-lists/, `href="#item${firstItem[1]}">Cross-lists`);
  html = replaceOnce(html, /href="#item\d+">Replacements/, `href="#item${firstItem[2]}">Replacements`);
  return html;
}

// --- A made-up researcher, as a fake INSPIRE serves them ----------------------------------------

export const DEMO_PROFILE_URL = 'https://inspirehep.net/authors/1234567';
const DEMO_RECID = 1234567;

export const DEMO_INTERESTS =
  'Black hole microstates and the gravitational path integral; near-extremal and near-BPS black holes; JT gravity and the Schwarzian; entanglement islands and the Page curve.';
export const DEMO_NOT_INTERESTED = 'Collider phenomenology, lattice simulations.';

interface DemoRecord {
  recid: number;
  arxiv: string;
  categories: string[];
  title: string;
  abstract: string;
}

const OWN: DemoRecord[] = [
  {
    recid: 3900001,
    arxiv: '2405.91421',
    categories: ['hep-th', 'gr-qc'],
    title: 'The Schwarzian mode and the low-temperature entropy of rotating AdS$_4$ black holes',
    abstract:
      'We revisit the low-temperature thermodynamics of charged and rotating black holes in four-dimensional anti-de Sitter space. Integrating out the throat region leaves a Schwarzian theory for the boundary reparametrisations, whose one-loop determinant produces a $\\frac{3}{2}\\log T$ correction to the entropy. The correction survives the inclusion of rotation and matter couplings and removes the apparent mass gap above extremality.',
  },
  {
    recid: 3900002,
    arxiv: '2502.91877',
    categories: ['hep-th', 'gr-qc'],
    title: 'Islands deep in the throat: the Page curve of near-extremal charged black holes',
    abstract:
      'We compute the fine-grained entropy of Hawking radiation from a charged black hole in AdS$_4$ coupled to a flat bath. Replica wormhole saddles of the gravitational path integral give rise to an entanglement island just outside the horizon after the Page time, and the entropy follows the Page curve. Near extremality the island moves deep into the throat and its contribution is controlled by the Schwarzian mode that governs the thermodynamics.',
  },
  {
    recid: 3900003,
    arxiv: '2509.90316',
    categories: ['hep-th'],
    title: 'Complex saddles of the large-$N$ index and rotating AdS$_5$ black holes',
    abstract:
      'We study the large-$N$ limit of the superconformal index of $\\mathcal{N}=4$ super Yang-Mills theory on $S^3\\times S^1$ with complex chemical potentials. A saddle-point analysis of the matrix model reproduces the Bekenstein-Hawking entropy of supersymmetric rotating black holes in AdS$_5$, including the constraint between charges and angular momenta, and identifies the subleading saddles responsible for logarithmic corrections.',
  },
];

const CITED: DemoRecord[] = [
  {
    recid: 3800001,
    arxiv: '1904.92031',
    categories: ['hep-th'],
    title: 'Exact boundary dynamics of dilaton gravity coupled to matter',
    abstract:
      'We study Jackiw-Teitelboim gravity coupled to matter and show that its boundary dynamics is governed by the Schwarzian action. We compute the partition function exactly and relate it to the low-energy limit of quantum mechanical models with random couplings.',
  },
  {
    recid: 3800002,
    arxiv: '2001.95512',
    categories: ['hep-th', 'gr-qc'],
    title: 'Entanglement islands from replica wormholes in dilaton gravity',
    abstract:
      'We give a prescription for the fine-grained entropy of radiation emitted by an evaporating black hole in which regions behind the horizon contribute as islands. The prescription follows from replica wormholes in the gravitational path integral and reproduces the Page curve in two-dimensional models.',
  },
  {
    recid: 3800003,
    arxiv: '1711.97804',
    categories: ['hep-th'],
    title: 'Generalised entropy and the nesting of entanglement wedges',
    abstract:
      'We formulate the generalised entropy prescription for holographic entanglement entropy including bulk quantum corrections, and prove that the resulting quantum extremal surfaces obey strong subadditivity and entanglement wedge nesting.',
  },
  {
    recid: 3800004,
    arxiv: '1810.93377',
    categories: ['hep-th'],
    title: 'Bethe-ansatz evaluation of the large-rank index and supersymmetric black holes',
    abstract:
      'We evaluate the superconformal index of four-dimensional gauge theories at large rank with a Bethe-ansatz approach and match its growth to the entropy of supersymmetric black holes in AdS$_5$.',
  },
  {
    recid: 3800005,
    arxiv: '1603.94420',
    categories: ['hep-th', 'gr-qc'],
    title: 'One-loop determinants in near-horizon geometries and extremal entropy',
    abstract:
      'We compute the logarithmic correction to the entropy of extremal black holes in four-dimensional supergravity from the one-loop determinants of massless fields in the near-horizon geometry, and compare with microscopic counting.',
  },
  {
    recid: 3800006,
    arxiv: '1907.98812',
    categories: ['hep-th'],
    title: 'Small-fugacity asymptotics of four-dimensional superconformal indices',
    abstract:
      'We study the superconformal index in the limit of small chemical potentials and derive a universal formula for its asymptotic growth in terms of the anomaly coefficients of the theory.',
  },
  {
    recid: 3800007,
    arxiv: '2103.96158',
    categories: ['hep-th'],
    title: 'Higher-derivative corrections to the extremality bound from unitarity',
    abstract:
      'We analyse higher-derivative corrections to the charge-to-mass ratio of extremal black holes and show that their positivity follows from unitarity and causality of the low-energy effective theory.',
  },
  {
    recid: 3800008,
    arxiv: '1801.91240',
    categories: ['hep-th', 'gr-qc'],
    title: 'Black holes in AdS with transparent boundary conditions and a radiation bath',
    abstract:
      'We construct holographic models in which a black hole in anti-de Sitter space is coupled to an external bath through transparent boundary conditions, and follow the entanglement between the black hole and the radiation in time.',
  },
  {
    recid: 3800009,
    arxiv: '2206.92284',
    categories: ['hep-th', 'gr-qc'],
    title: 'Quantum fluctuations of the throat and the absence of a mass gap',
    abstract:
      'We revisit the claim that charged black holes have a mass gap above extremality and show that large quantum fluctuations of the near-horizon geometry invalidate the semiclassical analysis below a temperature set by the inverse entropy.',
  },
];

const hits = (records: DemoRecord[]) => ({
  hits: {
    total: records.length,
    hits: records.map((r) => ({
      metadata: {
        control_number: r.recid,
        titles: [{ title: r.title }],
        abstracts: [{ value: r.abstract }],
        arxiv_eprints: [{ value: r.arxiv, categories: r.categories }],
      },
    })),
  },
});

/** What the fake INSPIRE answers to a request, or null to refuse it. */
export function demoInspireResponse(url: URL): unknown {
  if (url.pathname === `/api/authors/${DEMO_RECID}`) {
    return {
      metadata: {
        control_number: DEMO_RECID,
        name: { value: 'Ferreira, Ana', preferred_name: 'Ana Ferreira' },
        ids: [{ schema: 'INSPIRE BAI', value: 'A.Ferreira.1' }],
      },
    };
  }
  if (url.pathname === '/api/authors') return { hits: { total: 0, hits: [] } };
  if (url.pathname === '/api/literature') {
    const q = url.searchParams.get('q') ?? '';
    if (q === `authors.recid:${DEMO_RECID}`) return hits(OWN);
    if (q.startsWith('citedby:recid:')) return hits(CITED);
    return { hits: { total: 0, hits: [] } };
  }
  return null;
}
