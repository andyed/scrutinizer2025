# **Specification: Semantic Guidance & Linguistic Priming Layer**

## **1\. Executive Summary**

This feature introduces **Top-Down Attentional Control** to the Scrutinizer engine. By comparing the semantic meaning of a User Goal against the text content of a rendered page, we generate a **Semantic Saliency Map**. This map biases the simulated saccades toward "high information scent" areas, modeling how users scan for specific information rather than just reacting to bright colors or contrast.

## **2\. User Experience & Inputs**

### **2.1 Goal Input Mechanism**

The designer is presented with a "User Intent" panel. This input drives the generation of the Goal Embedding Vector ($\\vec{G}$).

### **2.2 Pre-Populated Intents (The "Persona" Menu)**

To facilitate quick testing, the system provides default weighted vectors representing common browsing modes:

| Intent Label | Description | Underlying Logic |
| :---- | :---- | :---- |
| **"Just Browsing"** (Baseline) | Low focus, high exploration. | $\\beta\_{semantic} \\approx 0$. Relies on visual pop-out (Itti-Koch) and novelty. |
| **"Find a Specific Item"** | High focus, narrow search. | User inputs specific keywords (e.g., "Returns Policy"). High $\\beta\_{semantic}$. |
| **"Validate Trustworthiness"** | Skeptical scrutiny. | Pre-calculated vector targeting terms like: *reviews, secure, privacy, verified, contact, address*. |
| **"Transact / Convert"** | Action-oriented. | Pre-calculated vector targeting: *buy, price, checkout, add to cart, sign up*. |
| **"Learn / Research"** | Information gathering. | vector targeting: *specs, features, how-to, documentation, details*. |

## ---

**3\. Scientific Basis & Expected Efficacy**

### **3.1 Theory: Top-Down Control & Information Scent**

Human vision is rarely passive; it is task-dependent. As demonstrated by **Yarbus (1967)**, eye movement patterns change drastically based on the viewer's goal.

* **Information Foraging Theory (Pirolli & Card, 1999):** Users follow "information scent"—visual or linguistic cues that estimate the probability of finding valuable information. This layer quantifies that scent.  
* Guided Search Model (Wolfe, 1994): Attention is a product of Bottom-Up (visual) and Top-Down (task) activation.

  $$Activation\_{total} \= W\_{bottom} \\cdot A\_{visual} \+ W\_{top} \\cdot A\_{semantic}$$

### **3.2 Linguistic Priming & Pre-Attentive Processing**

While deep reading requires foveal focus, **lexical processing begins parafoveally**.

* **Parafoveal Preview:** Readers process the length and partial shape of the *next* word before their eyes move to it (Rayner, 1998).  
* **Repetition Priming:** Words seen frequently or recently have lower recognition thresholds. We model this by boosting the saliency of repeated terms (e.g., if the user just read "Price", the next instance of "Price" or "$" pops out more easily).

## ---

**4\. Technical Architecture (In-Browser)**

To maintain the \<16ms (60fps) or \<5ms (ideal) target, heavy NLP inference must be decoupled from the main thread.

### **4.1 Technology Landscape & Selection**

| Technology | Verdict | Rationale |
| :---- | :---- | :---- |
| **TensorFlow.js** | ⚠️ Too Heavy | Mature, but often creates large bundle sizes and slower cold-start times for transformer models compared to ONNX. |
| **WebLLM** | ❌ Overkill | Designed for LLMs (Llama, Vicuna). Too resource-intensive for simple embedding generation. |
| **Transformers.js** (Rec.) | ✅ **Selected** | Runs state-of-the-art models via **ONNX Runtime Web**. Supports quantization (shrinking models to \<20MB). |
| **WebGPU** | ✅ **Target** | Essential for parallelizing the matrix multiplications of the attention mechanism. |
| **WASM (SIMD)** | ✅ **Fallback** | Robust fallback for devices without WebGPU support. |

### **4.2 Selected Model: all-MiniLM-L6-v2 (Quantized)**

* **Why:** It offers the best trade-off between speed and semantic accuracy. It maps sentences to a 384-dimensional dense vector space.  
* **Format:** ONNX Quantized (Int8).  
* **Size:** \~23MB (cacheable).

### **4.3 Data Structures**

1. **DOMMap:** A registry mapping spatial coordinates to text content.  
   JSON  
   \[{ "id": 1, "text": "Add to Cart", "rect": { "x": 100, "y": 200, "w": 80, "h": 40 } }, ...\]

2. **VectorCache:** A Map\<String, Float32Array\> storing computed embeddings for unique strings to avoid re-inference.

## ---

**5\. Implementation Logic (The Pipeline)**

This logic runs inside saliency-worker.js.

### **Phase 1: Initialization (Load)**

1. Check Cache API for all-MiniLM-L6-v2\_quantized.onnx.  
2. Initialize ort.InferenceSession (ONNX Runtime) with executionProviders: \['webgpu', 'wasm'\].

### **Phase 2: Goal Embedding ($\\vec{G}$)**

1. Receive User Goal String (e.g., "Find the price").  
2. Run Inference $\\rightarrow$ Output: $1 \\times 384$ Float32 vector.

### **Phase 3: Content Map Generation ($\\vec{C}$)**

*Triggered on DOM mutation or page load.*

1. Extract all visible text nodes.  
2. **Batch Processing:** Concatenate text nodes and tokenize in a single batch (up to 512 tokens per chunk).  
3. Run Inference $\\rightarrow$ Output: $N \\times 384$ matrix.  
4. Store vectors in DOMMap.

### **Phase 4: Saliency Computation**

For every pixel $(x,y)$ (or downsampled tile) covered by text node $i$:

1. Semantic Score ($S\_{sem}$):

   $$S\_{sem} \= \\frac{\\vec{G} \\cdot \\vec{C}\_i}{||\\vec{G}|| \\cdot ||\\vec{C}\_i||} \\quad (\\text{Cosine Similarity})$$

   (Range: \-1.0 to 1.0. Clamp negative values to 0).  
2. Priming/Frequency Boost ($B\_{freq}$):

   $$B\_{freq} \= \\ln(1 \+ \\text{Count}(Token\_i)) \\cdot k\_{prime}$$

   Where $k\_{prime}$ is a small constant (e.g., 0.1) to model the "ease of processing" for familiar terms.  
3. Final Map Integration:

   $$\\text{TotalMap}(x,y) \= \\alpha \\cdot \\text{VisualSaliency}(x,y) \+ \\beta \\cdot (S\_{sem} \+ B\_{freq})$$

   Typical values: $\\alpha=0.6, \\beta=0.4$ (configurable).

## ---

**6\. Visualization Output**

The Scrutinizer UI will visualize this layer as:

1. **"Scent Map" Overlay:** A toggleable heatmap showing only the Semantic Saliency layer. (e.g., If the goal is "Price", only numbers and currency symbols glow).  
2. **Predicted Gaze Path:** The saccade simulation will now "leap" towards high-scent areas, skipping over visually loud but semantically irrelevant elements (like decorative banners).

## **7\. References**

1. **Yarbus, A. L.** (1967). *Eye Movements and Vision*. Plenum Press. (Demonstrates task-dependent gaze trajectories).  
2. **Pirolli, P., & Card, S.** (1999). *Information Foraging*. Psychological Review. (Foundational theory for "Information Scent").  
3. **Wolfe, J. M.** (1994). *Guided Search 2.0: A revised model of visual search*. Psychonomic Bulletin & Review. (Architecture for combining top-down and bottom-up signals).  
4. **Rayner, K.** (1998). *Eye movements in reading and information processing: 20 years of research*. Psychological Bulletin. (Evidence for parafoveal preview and linguistic processing).  
5. **Hugging Face / Xenova**. (2023). *Transformers.js Documentation*. (Technical feasibility of browser-based embedding).