import { CourseDetail } from '../services/CacheService';

/**
 * Built-in course catalog and syllabus details for IISER Bhopal courses.
 * Provides instant rich course details and acts as offline fallback.
 */
export const DefaultCourseCatalog: Record<string, CourseDetail> = {
  DSE312: {
    courseCode: 'DSE312',
    courseTitle: 'Computer Vision',
    credits: '4',
    slot: 'O',
    instructors: 'Samiran Das',
    tutors: '',
    teachingAssistants: '',
    prerequisites: 'Linear Algebra, Probability, Data Structures and Algorithms',
    otherPrerequisites: '',
    learningObjectives: [
      'Ability to apply techniques for feature extraction and representation, tracking, segmentation, object detection and recognition.',
      'Ability to apply ideas from single and multi-view geometry in applications requiring depth/3D estimation.',
      'Ability to look up relevant literature and identify potential solutions for a given computer vision problem and implement them using existing tools/libraries (OpenCV).',
      'Ability to evaluate and compare quantitative performance of vision algorithms by using appropriate metrics.'
    ],
    textBooks: [
      'Ma, Soatto, Kosecka, Sastry, "An Invitation to 3D Vision", Springer, 2nd edition.',
      'David Forsyth and Jean Ponce, "Computer Vision: A Modern Approach", Prentice Hall, 2nd edition.',
      'Richard Hartley and Andrew Zisserman, "Multiple View Geometry", Cambridge University Press, 2004.',
      "Richard Szeliski's draft \"Computer Vision: Algorithms and Applications\"."
    ],
    referenceBooks: [
      'Simon J.D. Prince, "Computer Vision: Models, Learning, and Inference", Cambridge University Press.',
      'Christopher M. Bishop, "Pattern Recognition and Machine Learning", Springer.'
    ],
    content:
      'Introduction to Computer Vision, Camera geometry and camera calibration, Review of Digital Image Processing, Edge Detection and Hough Transforms, Image Segmentation, Feature Point Detection - Harris, SIFT, HOG, LBP, STIP, Feature Detection and Description - Bag Of Words, VLAD, Object Recognition - SVMs, Detection - Viola Jones Object detector, Convolutional Neural Networks and Applications, Optical Flow, KLT based object tracking, Linear Algebra review, Projective Geometry - Basics and 2D transformations (Euclidean, Similarity, Affine and Projective), Epipolar Geometry - Fundamental and Essential Matrix, Least Squares and Robust Estimation (RANSAC), Stereo reconstruction, SfM and Bundle Adjustment, Homography and panorama creation, Recent Progress in Computer Vision.',
    remark: ''
  },
  DSE317: {
    courseCode: 'DSE317',
    courseTitle: 'Machine Learning',
    credits: '4',
    slot: 'B',
    instructors: 'Sundaram Muthu',
    tutors: '',
    teachingAssistants: '',
    prerequisites: 'Linear Algebra, Probability and Statistics, Programming in Python',
    otherPrerequisites: '',
    learningObjectives: [
      'Understand foundational mathematical concepts underlying machine learning algorithms.',
      'Design, implement, and evaluate supervised and unsupervised learning algorithms.',
      'Apply regularization, cross-validation, and hyperparameter tuning techniques.',
      'Implement real-world ML pipelines using NumPy, Scikit-Learn, and PyTorch.'
    ],
    textBooks: [
      'Kevin P. Murphy, "Machine Learning: A Probabilistic Perspective", MIT Press.',
      'Christopher M. Bishop, "Pattern Recognition and Machine Learning", Springer.',
      'Trevor Hastie, Robert Tibshirani, Jerome Friedman, "The Elements of Statistical Learning", Springer.'
    ],
    referenceBooks: [
      'Tom M. Mitchell, "Machine Learning", McGraw-Hill.',
      'Ian Goodfellow, Yoshua Bengio, Aaron Courville, "Deep Learning", MIT Press.'
    ],
    content:
      'Supervised Learning: Linear Regression, Ridge & Lasso, Logistic Regression, Discriminant Analysis. Support Vector Machines, Kernel methods. Decision Trees, Random Forests, Gradient Boosting. Unsupervised Learning: K-Means, Hierarchical Clustering, Gaussian Mixture Models, EM algorithm. Dimensionality Reduction: PCA, t-SNE, SVD. Model Selection, Bias-Variance tradeoff, Ensemble learning, Neural Network fundamentals.',
    remark: ''
  },
  DSE325: {
    courseCode: 'DSE325',
    courseTitle: 'Algorithm and Data Structure Lab',
    credits: '2',
    slot: 'Lab',
    instructors: 'Tanmay Basu, Priyanka Dey',
    tutors: '',
    teachingAssistants: '',
    prerequisites: 'Data Structures and Algorithms',
    otherPrerequisites: '',
    learningObjectives: [
      'Hands-on implementation of core data structures: Trees, Heaps, Hash Tables, and Disjoint Sets.',
      'Practical problem-solving using Divide-and-Conquer, Dynamic Programming, and Greedy techniques.',
      'Graph algorithm implementation: Shortest Paths, Minimum Spanning Trees, and Network Flow.',
      'Benchmarking asymptotic time and space complexities with experimental empirical analysis.'
    ],
    textBooks: [
      'Thomas H. Cormen, Charles E. Leiserson, Ronald L. Rivest, Clifford Stein, "Introduction to Algorithms", MIT Press.',
      'Robert Sedgewick and Kevin Wayne, "Algorithms", Addison-Wesley.'
    ],
    referenceBooks: [
      'Jon Kleinberg, Éva Tardos, "Algorithm Design", Pearson.'
    ],
    content:
      'Laboratory experiments covering implementation of Linked lists, Stacks, Queues, Binary Search Trees, AVL Trees, Red-Black Trees, Priority Queues / Heaps, Sorting algorithms, Graph representations and traversals (BFS, DFS), Dijkstra and Bellman-Ford algorithms, Kruskal and Prim MST, Dynamic Programming assignments.',
    remark: ''
  },
  DSE335: {
    courseCode: 'DSE335',
    courseTitle: 'Optimization Techniques',
    credits: '4',
    slot: 'C',
    instructors: 'Sujit Pedda Baliyarasimhuni',
    tutors: '',
    teachingAssistants: '',
    prerequisites: 'Multivariable Calculus, Linear Algebra',
    otherPrerequisites: '',
    learningObjectives: [
      'Formulate real-world engineering and data science problems as constrained and unconstrained optimization problems.',
      'Understand optimality conditions including KKT conditions and duality theory.',
      'Implement first-order and second-order optimization algorithms (Gradient Descent, Newton method, Quasi-Newton).',
      'Apply convex optimization methods to machine learning and signal processing tasks.'
    ],
    textBooks: [
      'Stephen Boyd and Lieven Vandenberghe, "Convex Optimization", Cambridge University Press.',
      'Jorge Nocedal and Stephen J. Wright, "Numerical Optimization", Springer.'
    ],
    referenceBooks: [
      'Dimitri P. Bertsekas, "Nonlinear Programming", Athena Scientific.'
    ],
    content:
      'Convex sets and functions, Epigraphs, Subgradients. Unconstrained optimization: Gradient descent, Conjugate gradient, Newton method, Line search strategies, Trust region methods. Constrained optimization: Lagrange multipliers, KKT optimality conditions, Duality, Linear programming (Simplex), Quadratic programming, Interior point methods.',
    remark: ''
  },
  DSE351: {
    courseCode: 'DSE351',
    courseTitle: 'Engineering Mathematics',
    credits: '4',
    slot: 'D',
    instructors: 'Priyadarshi Mukherjee',
    tutors: '',
    teachingAssistants: '',
    prerequisites: 'Calculus and Linear Algebra',
    otherPrerequisites: '',
    learningObjectives: [
      'Master analytical and numerical methods for solving Ordinary and Partial Differential Equations.',
      'Understand Fourier series, Fourier transforms, and Laplace transforms.',
      'Apply complex variable theory and residue calculus to engineering problems.'
    ],
    textBooks: [
      'Erwin Kreyszig, "Advanced Engineering Mathematics", Wiley.',
      'Dennis G. Zill, "Advanced Engineering Mathematics", Jones & Bartlett.'
    ],
    referenceBooks: [
      'E. Boyce, R. DiPrima, "Elementary Differential Equations and Boundary Value Problems", Wiley.'
    ],
    content:
      'First and higher-order ODEs, Systems of differential equations, Laplace transforms and applications, Fourier series, Fourier integrals and transforms, Partial Differential Equations (Wave equation, Heat equation, Laplace equation), Complex variables, Analytic functions, Cauchy-Riemann equations, Contour integration.',
    remark: ''
  },
  DSE353: {
    courseCode: 'DSE353',
    courseTitle: 'Probability and Random Processes',
    credits: '4',
    slot: 'E',
    instructors: 'Vivek Deulkar',
    tutors: '',
    teachingAssistants: '',
    prerequisites: 'Calculus, Real Analysis basics',
    otherPrerequisites: '',
    learningObjectives: [
      'Develop rigorous probabilistic thinking and intuition for random phenomena.',
      'Analyze multivariate probability distributions, joint distributions, and conditional expectations.',
      'Understand convergence concepts (almost sure, in probability, in distribution) and Limit Theorems.',
      'Model stochastic systems using Markov Chains and Poisson Processes.'
    ],
    textBooks: [
      'Sheldon M. Ross, "Introduction to Probability Models", Academic Press.',
      'A. Papoulis and S. U. Pillai, "Probability, Random Variables, and Stochastic Processes", McGraw-Hill.'
    ],
    referenceBooks: [
      'Dimitri P. Bertsekas and John N. Tsitsiklis, "Introduction to Probability", Athena Scientific.'
    ],
    content:
      'Probability space, Conditional probability, Bayes theorem, Random variables (discrete and continuous), Joint distributions, Covariance, Correlation, Characteristic functions, Law of Large Numbers, Central Limit Theorem, Random processes, Markov chains, Transition matrices, Stationary distributions, Poisson processes, Autocorrelation, Spectral density.',
    remark: ''
  },
  DSE355: {
    courseCode: 'DSE355',
    courseTitle: 'Computer Organisation',
    credits: '4',
    slot: 'F',
    instructors: 'Sukarn Agarwal',
    tutors: '',
    teachingAssistants: '',
    prerequisites: 'Digital Logic and Design',
    otherPrerequisites: '',
    learningObjectives: [
      'Understand processor architecture, instruction set design (RISC/CISC), and assembly execution.',
      'Analyze pipelining, hazards (data, control, structural), and branch prediction mechanisms.',
      'Understand the memory hierarchy: Cache design, Cache coherence, and Virtual Memory.',
      'Analyze I/O architectures, interrupts, and bus protocols.'
    ],
    textBooks: [
      'David A. Patterson and John L. Hennessy, "Computer Organization and Design: The Hardware/Software Interface", Morgan Kaufmann (RISC-V Edition).',
      'William Stallings, "Computer Organization and Architecture", Pearson.'
    ],
    referenceBooks: [
      'Andrew S. Tanenbaum, Todd Austin, "Structured Computer Organization", Pearson.'
    ],
    content:
      'Basic structure of computers, Instruction sets (RISC-V / MIPS), Instruction formats and addressing modes, Computer arithmetic (ALU, fast adders, multipliers), Processor datapath and control unit, Pipelining, Hazard detection and resolution, Memory hierarchy, Cache memory mapping and policies, Virtual memory and TLB, Storage and I/O organization, DMA, Multicore concepts.',
    remark: ''
  }
};

/**
 * Resolves course details by checking the runtime cache first, then the built-in catalog,
 * and finally constructing a clean synthesized detail object.
 */
export function getCourseDetailFor(
  courseCode: string,
  courseTitle: string,
  instructor: string,
  cachedMap?: Record<string, CourseDetail>
): CourseDetail {
  const code = (courseCode || '').trim().toUpperCase();

  // 1. Check cached details from portal scraper
  if (cachedMap && cachedMap[code] && cachedMap[code].content) {
    return cachedMap[code];
  }

  // 2. Check built-in course catalog
  if (DefaultCourseCatalog[code]) {
    const catalogItem = DefaultCourseCatalog[code];
    return {
      ...catalogItem,
      courseTitle: courseTitle || catalogItem.courseTitle,
      instructors: instructor || catalogItem.instructors,
    };
  }

  // 3. Fallback structure
  return {
    courseCode: code,
    courseTitle: courseTitle || code,
    credits: '4',
    slot: 'N/A',
    instructors: instructor || 'Instructor Not Assigned',
    tutors: '',
    teachingAssistants: '',
    prerequisites: 'Prerequisites will be updated after portal sync.',
    otherPrerequisites: '',
    learningObjectives: [
      `Complete foundational topics in ${courseTitle || code}.`,
      'Apply analytical and experimental methods to course problem sets.',
      'Understand core principles and applications in modern science and engineering.'
    ],
    textBooks: [
      'Standard reference textbooks recommended by the course instructor.'
    ],
    referenceBooks: [],
    content: `Comprehensive syllabus and course curriculum for ${courseTitle || code} as prescribed by the department curriculum committee.`,
    remark: ''
  };
}
