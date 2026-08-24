# AlphaEvolve (Google DeepMind): LLM-Driven Evolutionary Coding Agent

AlphaEvolve (unveiled by Google DeepMind in 2025) is a general-purpose evolutionary coding agent. Unlike earlier systems that were confined to specific domains (like AlphaTensor for math or AlphaFold for biology), AlphaEvolve autonomously discovers, optimizes, and rewrites general algorithms by directly modifying human-readable source code (Python, C++, Verilog, etc.).

It operates by combining the generative power of Large Language Models (LLMs) with the rigorous verification of Evolutionary Computation.

---

## 1. Core Architecture

To implement a system similar to AlphaEvolve, you need four primary components working in a closed, iterative loop:

### A. The LLM Ensemble (The "Mutator")
AlphaEvolve uses a tiered LLM approach to balance breadth (exploration) and depth (exploitation):
*   **The Explorer (e.g., Gemini Flash, Claude Haiku):** Generates a high volume of candidate code modifications quickly. This ensures the search space is broadly covered.
*   **The Refiner (e.g., Gemini Pro, Claude Opus):** Applies deeper, more complex reasoning to mutate high-potential candidates or solve particularly difficult logic bottlenecks.

### B. The Program Database (The "Population")
A central repository that stores the population of valid algorithms. For every program, it tracks:
*   **Source Code:** The actual human-readable code.
*   **Fitness Metrics:** Scores based on execution (e.g., runtime, memory usage, accuracy).
*   **Lineage:** The history of mutations that led to this specific version (parent-child relationships).

### C. The Prompt Sampler (The "Tournament Selection")
This component is responsible for selecting "parent" programs from the database and constructing the prompts for the LLM. 
*   It selects programs based on their fitness scores.
*   It feeds the LLM the parent's source code, its performance metrics, and any execution logs or error traces, asking the LLM to propose a "diff" (mutation) or combine logic from two parents (crossover).

### D. The Automated Evaluator (The "Fitness Function")
A strictly controlled sandbox environment where proposed code modifications are executed. 
*   This grounds the LLM in reality, preventing hallucinations from corrupting the evolutionary process.
*   The evaluator runs the code against a user-defined test suite or benchmark and returns scalar metrics (e.g., milliseconds taken, accuracy percentage).

---

## 2. The Evolutionary Workflow

If you are building a clone of this system, your orchestration logic should follow this step-by-step loop:

1.  **Initialization:** The human user provides a "skeleton" of the code (a starting point, which can be a naive algorithm) and the evaluation function.
2.  **Prompting:** The Prompt Sampler picks a strong candidate from the Program Database and asks the LLM Ensemble to improve it.
3.  **Generation:** The LLM returns a proposed modification (diff).
4.  **Execution:** The Automated Evaluator compiles/runs the modified code in the sandbox.
    *   *If the code fails to compile, crashes, or performs worse:* It is immediately discarded. (Optionally, the error log can be fed back to the LLM for a retry).
    *   *If the code succeeds and improves upon the metrics:* It is added to the Program Database.
5.  **Iteration:** The newly successful code becomes a potential parent for the next generation. The loop repeats thousands or millions of times.

---

## 3. Key Design Principles for Implementation

If you are implementing your own "OpenEvolve" clone, keep these principles in mind:

*   **Diff-Based Mutations:** Do not ask the LLM to rewrite the entire file from scratch every time. Ask it to generate unified diffs or targeted function replacements. This is significantly faster and less prone to breaking unrelated logic.
*   **Deterministic Evaluation:** Your sandbox must be highly deterministic. If an algorithm's execution time fluctuates wildly due to background OS noise, your fitness metrics will be flawed, and the evolution will fail.
*   **Diversity Preservation:** Just like biological evolution, if your Program Database converges on a single algorithm too quickly, it gets stuck in a local optimum. Force the Prompt Sampler to occasionally pick lower-performing but highly diverse code structures to explore new branches.
*   **Grounding in Code:** The secret to AlphaEvolve's success is that it doesn't rely on the LLM to "know" the answer. It relies on the LLM to *guess* the answer, and relies entirely on the compiler and test suite to *verify* it. 

## 4. Notable Achievements (For Context)
To understand the power of this architecture, DeepMind used AlphaEvolve to:
*   Discover a method to multiply 4x4 complex matrices using only 48 scalar multiplications (breaking a 56-year-old mathematical record).
*   Optimize Google's Borg data center scheduler, recovering 0.7% of global compute resources.
*   Rewrite hardware definitions (Verilog) for TPU circuits to remove redundant logic.
