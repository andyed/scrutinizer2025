# **Specification: Semantic Guidance & Linguistic Priming Layer (v2)**

> [!NOTE]
> **Version 2.0** — This revision incorporates a critical review addressing gaps in the original spec, particularly regarding legibility gating, icon recognition, and dynamic attention weighting.

## **1. Executive Summary**

This feature introduces **Top-Down Attentional Control** to the Scrutinizer engine. By comparing the semantic meaning of a User Goal against the text content of a rendered page, we generate a **Semantic Saliency Map**. This map biases the simulated saccades toward "high information scent" areas, modeling how users scan for specific information rather than just reacting to bright colors or contrast.

---

## **2. User Experience & Inputs**

### **2.1 Goal Input Mechanism**

The designer is presented with a "User Intent" panel. This input drives the generation of the Goal Embedding Vector ($\vec{G}$).

### **2.2 Pre-Populated Intents (The "Persona" Menu)**

To facilitate quick testing, the system provides default weighted vectors representing common browsing modes:

| Intent Label | Description | Underlying Logic |
| :---- | :---- | :---- |
| **"Just Browsing"** (Baseline) | Low focus, high exploration. | $\beta_{semantic} \approx 0$. Relies on visual pop-out (Itti-Koch) and novelty. |
| **"Find a Specific Item"** | High focus, narrow search. | User inputs specific keywords (e.g., "Returns Policy"). High $\beta_{semantic}$. |
| **"Validate Trustworthiness"** | Skeptical scrutiny. | Pre-calculated vector targeting terms like: *reviews, secure, privacy, verified, contact, address*. |
| **"Transact / Convert"** | Action-oriented. | Pre-calculated vector targeting: *buy, price, checkout, add to cart, sign up*. |
| **"Learn / Research"** | Information gathering. | vector targeting: *specs, features, how-to, documentation, details*. |

---

## **3. Scientific Basis & Expected Efficacy**

### **3.1 Theory: Top-Down Control & Information Scent**

Human vision is rarely passive; it is task-dependent. As demonstrated by **Yarbus (1967)**, eye movement patterns change drastically based on the viewer's goal.

* **Information Foraging Theory (Pirolli & Card, 1999):** Users follow "information scent"—visual or linguistic cues that estimate the probability of finding valuable information. This layer quantifies that scent.  
* **Guided Search Model (Wolfe, 1994):** Attention is a product of Bottom-Up (visual) and Top-Down (task) activation.

$$Activation_{total} = W_{bottom} \cdot A_{visual} + W_{top} \cdot A_{semantic}$$

### **3.2 Linguistic Priming & Pre-Attentive Processing**

While deep reading requires foveal focus, **lexical processing begins parafoveally**.

* **Parafoveal Preview:** Readers process the length and partial shape of the *next* word before their eyes move to it (Rayner, 1998).  
* **Repetition Priming:** Words seen frequently or recently have lower recognition thresholds. We model this by boosting the saliency of repeated terms (e.g., if the user just read "Price", the next instance of "Price" or "$" pops out more easily).

### **3.3 The Eccentricity-Semantics Interaction** *(New in v2)*

We must model the interaction between visual capability and semantic processing. A strong semantic match is irrelevant if the user cannot physically read the text.

**Legibility Gating:** The Semantic Score ($S_{sem}$) must be modulated by a Visual Acuity function ($A_{visual}$). If a text node is in the far periphery (e.g., >10° eccentricity) and the font size is below the resolution threshold, its semantic signal is suppressed. This forces the simulation to make exploratory saccades to "zoom in" before confirming a match.

$$S_{effective} = S_{sem} \cdot \text{Sigmoid}( \text{Legibility}(font\_size, eccentricity) )$$

> [!IMPORTANT]
> **The "Eagle Eye" Fallacy:** The original model assumed that if a word matches the goal, it generates saliency regardless of size or position. Physiologically, a user cannot process the semantics of a word in their periphery if the visual acuity at that eccentricity is insufficient to resolve the letters. The semantic signal must be gated by legibility.

---

## **4. Technical Architecture (In-Browser)**

To maintain the <16ms (60fps) or <5ms (ideal) target, heavy NLP inference must be decoupled from the main thread.

### **4.1 Technology Landscape & Selection**

| Technology | Verdict | Rationale |
| :---- | :---- | :---- |
| **TensorFlow.js** | ⚠️ Too Heavy | Mature, but often creates large bundle sizes and slower cold-start times for transformer models compared to ONNX. |
| **WebLLM** | ❌ Overkill | Designed for LLMs (Llama, Vicuna). Too resource-intensive for simple embedding generation. |
| **Transformers.js** (Rec.) | ✅ **Selected** | Runs state-of-the-art models via **ONNX Runtime Web**. Supports quantization (shrinking models to <20MB). |
| **WebGPU** | ✅ **Target** | Essential for parallelizing the matrix multiplications of the attention mechanism. |
| **WASM (SIMD)** | ✅ **Fallback** | Robust fallback for devices without WebGPU support. |

### **4.2 Selected Model: all-MiniLM-L6-v2 (Quantized)**

* **Why:** It offers the best trade-off between speed and semantic accuracy. It maps sentences to a 384-dimensional dense vector space.  
* **Format:** ONNX Quantized (Int8).  
* **Size:** ~23MB (cacheable).

### **4.3 Data Structures**

1. **DOMMap:** A registry mapping spatial coordinates to text content.  
   ```json
   [{ "id": 1, "text": "Add to Cart", "rect": { "x": 100, "y": 200, "w": 80, "h": 40 } }, ...]
   ```

2. **VectorCache:** A `Map<String, Float32Array>` storing computed embeddings for unique strings to avoid re-inference.

3. **Icon/Symbol Dictionary** *(New in v2)*: A lightweight lookup table mapping common UI icon classes and SVGs to semantic keywords.
   
   | Icon Pattern | Semantic Keyword |
   |--------------|------------------|
   | `fa-shopping-cart`, `cart-icon` | "Shopping Cart" |
   | `fa-search`, `material-icons-search` | "Search" |
   | `fa-bars`, `hamburger-menu` | "Navigation Menu" |
   | `fa-user`, `account-icon` | "Account" |
   | `fa-heart`, `wishlist` | "Favorites" |
   
   **Implementation:** Scan class lists for patterns. Map matched icons to keywords before embedding.
   
   **Rationale:** Addresses the "Icon Blindness" problem—modern UIs use icons for critical navigation, and a text-only scanner would miss these.

4. **QuadTree Spatial Index** *(New in v2)*: Enables O(log n) spatial lookups during the render loop instead of O(n) linear scans.

---

## **5. Implementation Logic (The Pipeline)**

This logic runs inside `saliency-worker.js`.

### **Phase 1: Initialization (Load)**

1. Check Cache API for `all-MiniLM-L6-v2_quantized.onnx`.  
2. Initialize `ort.InferenceSession` (ONNX Runtime) with `executionProviders: ['webgpu', 'wasm']`.

### **Phase 2: Goal Embedding ($\vec{G}$)**

1. Receive User Goal String (e.g., "Find the price").  
2. Run Inference → Output: $1 \times 384$ Float32 vector.

### **Phase 3: Content Map Generation ($\vec{C}$)**

**Trigger:** `IntersectionObserver` (viewport changes) + `MutationObserver` (debounced 500ms).

> [!TIP]
> **Performance on Dynamic Pages:** SPAs often trigger rapid micro-mutations. The 500ms debounce prevents flooding the inference engine.

**Steps:**

1. **Viewport Filtering:** Only extract text nodes currently visible within the viewport + 200px buffer. This prevents wasting cycles on footer content when the user is at the header.
2. **Icon Augmentation:** Inject semantic keywords for identified icons into the token stream.
3. **Batch Processing:** Concatenate text nodes and tokenize in a single batch (up to 512 tokens per chunk).  
4. **Run Inference** → Output: $N \times 384$ matrix.  
5. **Spatial Indexing:** Insert results into QuadTree for fast spatial lookups during render loop.

### **Phase 4: Saliency Computation (The "Dual-Stream" Controller)**

Instead of a static mix, use a **dynamic controller** based on Task Uncertainty.

#### **4.1 Semantic Score ($S_{sem}$)**

$$S_{sem} = \frac{\vec{G} \cdot \vec{C}_i}{||\vec{G}|| \cdot ||\vec{C}_i||} \quad (\text{Cosine Similarity})$$

(Range: -1.0 to 1.0. Clamp negative values to 0).

#### **4.2 Legibility Gating** *(New in v2)*

Calculate visual acuity at node $i$'s distance from the current simulated gaze point $(g_x, g_y)$.

```javascript
const eccentricity = distanceFromGaze(node.rect, gazePoint);
const minLegibleSize = getMinLegibleFontSize(eccentricity);
const legibility = sigmoid((node.fontSize - minLegibleSize) / 4);
const S_effective = S_sem * legibility;
```

If `legibility < threshold`, set $S_{sem} \approx 0$. The user knows *something* is there, but not *what* it says.

#### **4.3 Dynamic Weighting (Exploration vs Exploitation)** *(New in v2)*

| Mode | Condition | Behavior |
|------|-----------|----------|
| **Exploration** | max($S_{sem}$) across viewport is low | No strong scent. Boost Bottom-Up (Visual) saliency. User is "lost" and defaults to scanning salient features. |
| **Exploitation** | max($S_{sem}$) is high | Strong scent detected. Suppress Bottom-Up saliency. User is "locked on" and will filter out visual noise (e.g., ads). |

$$\beta_{dynamic} = \text{Sigmoid}(\max(S_{sem}) - k)$$
$$\alpha_{dynamic} = 1.0 - \beta_{dynamic}$$

> [!NOTE]
> **Static Weighting Critique:** The original spec suggested a fixed 60/40 mix of visual vs semantic saliency. In reality, this relationship is dynamic. The new controller adapts based on detected scent strength.

#### **4.4 Priming/Frequency Boost ($B_{freq}$)**

$$B_{freq} = \ln(1 + \text{Count}(Token_i)) \cdot k_{prime}$$

Where $k_{prime}$ is a small constant (e.g., 0.1) to model the "ease of processing" for familiar terms.

#### **4.5 Final Map Integration**

$$\text{Map}(x,y) = \alpha_{dynamic} \cdot V(x,y) + \beta_{dynamic} \cdot (S_{effective} + B_{freq})$$

---

## **6. Visualization Output**

The Scrutinizer UI will visualize this layer as:

1. **"Scent Map" Overlay:** A toggleable heatmap showing only the Semantic Saliency layer. (e.g., If the goal is "Price", only numbers and currency symbols glow).

2. **Predicted Gaze Path:** The saccade simulation will now "leap" towards high-scent areas, skipping over visually loud but semantically irrelevant elements (like decorative banners).

3. **"Distractor Analysis" Panel** *(New in v2)*: A list of elements that have high Visual Saliency but low Semantic Saliency relative to the current goal.

   **Example Output:**
   > "The 'Sign Up' modal is visually dominant ($V=0.9$) but semantically irrelevant ($S=0.1$) to the 'Checkout' goal. It is a **Distractor**."

   **Use Case:** Helps designers identify UI elements that compete for attention but don't serve the user's task.

---

## **7. Critique Summary (v1 → v2)**

| Issue | v1 Weakness | v2 Solution |
|-------|-------------|-------------|
| **Icon Blindness** | Text-only scanning misses icon-based navigation | Icon/Symbol Dictionary maps common icons to semantic keywords |
| **Static Weighting** | Fixed α/β ratio feels robotic | Dynamic Exploration/Exploitation controller |
| **Dynamic Pages** | Batch processing all nodes risks flooding | Viewport filtering + 500ms debounce + QuadTree indexing |
| **Eagle Eye Fallacy** | Semantic match regardless of legibility | Legibility gating suppresses signals from illegible periphery |

---

## **8. References**

1. **Yarbus, A. L.** (1967). *Eye Movements and Vision*. Plenum Press. (Demonstrates task-dependent gaze trajectories).  
2. **Pirolli, P., & Card, S.** (1999). *Information Foraging*. Psychological Review. (Foundational theory for "Information Scent").  
3. **Wolfe, J. M.** (1994). *Guided Search 2.0: A revised model of visual search*. Psychonomic Bulletin & Review. (Architecture for combining top-down and bottom-up signals).  
4. **Rayner, K.** (1998). *Eye movements in reading and information processing: 20 years of research*. Psychological Bulletin. (Evidence for parafoveal preview and linguistic processing).  
5. **Hugging Face / Xenova**. (2023). *Transformers.js Documentation*. (Technical feasibility of browser-based embedding).