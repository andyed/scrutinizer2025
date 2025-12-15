

### **The Core Shift: From Synthesis to Generalization**

* **Old Way (TTM/Synthesis):** "I need to calculate the statistics of this specific patch of pixels and iteratively grow a new patch that matches them." (Slow, perfect for offline analysis).  
* **New Way (Generalization):** "I've seen millions of UI elements. This patch in the periphery looks like a 'List Item.' I will hallucinate a generic 'List Item' texture here based on the foveal color/contrast, without needing to calculate complex statistics from scratch." (Fast, perfect for real-time).

This aligns with recent research (like the "SideEye" Foveated Generative Network 1111) which uses a neural network to *predict* the peripheral degradation in a single pass, rather than synthesizing it iteratively. It achieves a \~21,000x speedup222.

# ---

**Specification: Unified Neural Perception Layer (UNPL)**

\[\!NOTE\]  
Architectural Alignment: This specification runs parallel to the Linguistic Pre-Attentive Layer, sharing the same runtime environment (transformers.js / ONNX) to minimize overhead. It unifies the "Goal-Directed" (Linguistic) and "Texture-Statistical" (Visual) aspects of the Scrutinizer engine.  
\[\!IMPORTANT\]  
Implementation Status: PLANNED

* **Primary Role:** De-couples "Cognitive" processing (slow, \~100ms) from "Retinal" rendering (fast, 16ms).  
* **Core Output:** A NeuralTextureMap (low-res) that drives the high-res GLSL shaders.  
* **Dependencies:** saliency-worker.js (to be upgraded to cognitive-worker.ts), WebGPU support.

## ---

**1\. Executive Summary**

This layer introduces a **Shared Neural Substrate** for the Scrutinizer/Psychodeli engine. Instead of relying on heuristic edge detection (Sobel filters) to guess what is important, we use lightweight Transformer and Generative models to *understand* and *reconstruct* the visual field.

This system serves two masters:

1. **Scrutinizer (Simulation):** Provides the "Semantic Saliency" needed to simulate Goal-Directed attention (e.g., "Find the red shoes").  
2. **Psychodeli (VJ/Visuals):** Drives the "Mongrel" texture generation, using neural features to predict peripheral degradation in a single pass3.

## ---

**2\. Architecture: The "Cognitive Worker"**

To prevent main-thread jank, all neural inference occurs in a dedicated Web Worker sharing a single ONNX Runtime environment.

### **2.1 The Unified Pipeline**

### **2.2 Model Selection (The "Tiny" Stack)**

We prioritize speed over precision. The models must run in-browser via WebGPU or WASM.

| Component | Selected Model | Role | Output | Size (Quantized) |
| :---- | :---- | :---- | :---- | :---- |
| **Visual Backbone** | **SegFormer-b0** (or FGN variant) | Texture Analysis & Segmentation | "This patch is Sky / Text / Face" | \~3.7 MB |
| **Cross-Modal Bridge** | **CLIP (ViT-B/32)** | Semantic Matching | "This patch matches the user's goal" | \~40 MB |
| **Linguistic Core** | **all-MiniLM-L6-v2** | Text Scent (from Linguistic Spec) | "This text matches the user's goal" | \~22 MB |

## ---

**3\. Visual Compute: The "Neural Mongrel" Driver**

Generating a true "Mongrel" (statistical texture synthesis) pixel-by-pixel is too slow for 60fps video4. Instead, we use the neural network to generate a **Parametric Distortion Field** or a direct prediction map.

### **3.1 The "Parametric" Trick**

The Neural Layer does not render the visual. It outputs a control texture (e.g., 64x64px) that tells the *Shader* how to render the visual.

**Output Texture (u\_neuralMap):**

* **Red Channel (Entropy/Complexity):** Derived from the Vision Transformer's attention map entropy. High entropy areas (foliage, noise) get *stronger* scrambling in the shader. Low entropy areas (flat UI, sky) get weaker scrambling.  
* **Green Channel (Anisotropy/Direction):** Derived from the feature gradients. Tells the shader *which direction* to smash the texture.  
  * *Text:* High horizontal anisotropy (Smash X).  
  * *Trees:* Isotropic (Smash XY).  
* **Blue Channel (Semantic Class):** A simplified ID from SegFormer (0.0=Background, 0.5=Object, 1.0=Face/Text). Used to protect sensitive regions (Fidelity Bias).  
* **Alpha Channel (Saliency):** The result of the CLIP Goal Match (see Section 4).

### **3.2 "Mongrel" Shader Implementation**

The GLSL shader samples this neural map to perform "Smart Domain Warping" rather than random noise. This mimics the "jumbling" loss of position information while preserving basic features like orientation and contrast5.

OpenGL Shading Language

// In Fragment Shader (Psychodeli / Scrutinizer V1 Stage)  
vec4 neuralData \= texture(u\_neuralMap, uv\_lowres);

float entropy \= neuralData.r;      // How "busy" is this area?  
float direction \= neuralData.g;    // 0.0 \= Horizontal smash, 1.0 \= Omni  
float saliency \= neuralData.a;     // Is this important?

// 1\. Fidelity Bias: If saliency is high, reduce scrambling  
float scrambleStrength \= entropy \* (1.0 \- saliency) \* u\_peripheralStrength;

// 2\. Anisotropic Warping (Lateral Inhibition)  
vec2 warpDir \= mix(vec2(1.0, 0.1), vec2(1.0, 1.0), direction); 

// 3\. The Mongrel Lookup  
vec2 mongrelUV \= uv \+ (noise(uv) \* warpDir) \* scrambleStrength;  
vec4 color \= texture(u\_texture, mongrelUV);

## ---

**4\. Cross-Modal Fusion (Visual Saliency)**

This is the bridge between the **Linguistic Spec** and the **Visual Spec**.

### **4.1 The Mechanism (CLIP)**

1. **User Goal:** "Find the red shoes."  
2. **Text Encoder:** Converts goal to vector $\\vec{G}$.  
3. **Image Encoder:** Scans the viewport in patches (e.g., 8x8 grid), creating a matrix of vectors $\\vec{I}\_{x,y}$.  
4. **Dot Product:** We compute the cosine similarity map: $S\_{x,y} \= \\vec{G} \\cdot \\vec{I}\_{x,y}$.

### **4.2 The Outcome**

* **Result:** A heatmap where pixels matching "red shoes" light up (High Alpha in u\_neuralMap).  
* **Shader Effect:** High Alpha areas are "protected" from the Mongrel effect. They remain crisp in the periphery, simulating "Pop-Out" attention.  
* **Benefit:** This models **Feature Search** (pre-attentive) rather than just **Spatial Search**.

## ---

**5\. Special Handling: Color & Saturation**

As noted in your observation: *"Mongrels are fully color saturated."* The TTM model generally preserves color statistics, even as spatial information degrades6.

### **5.1 Neural Saturation Preservation**

Standard blurring desaturates images (averaging colors \-\> gray). Neural texture features preserve "Color Energy."

* **Implementation:** The shader logic driven by the NeuralTextureMap must use **Domain Warping** (moving pixels around) rather than **Convolution** (blurring pixels together).  
* **Psychodeli VJ Mode:** We can use the **Red Channel (Entropy)** to drive a "Color Vibrance" boost in the shader.  
  * *Logic:* "If this region is statistically complex (high entropy), boost saturation to mimic the brain's over-estimation of peripheral color."

## ---

**6\. Integration Roadmap**

### **Step 1: The "Blind" Worker (Infrastructure)**

* Set up cognitive-worker.ts.  
* Install @xenova/transformers.  
* Implement postMessage loop for passing OffscreenCanvas bitmaps.

### **Step 2: The Texture Analyzer (Visual)**

* Load SegFormer.  
* Feed downsampled (256x256) frames.  
* Output the u\_neuralMap to the shader.  
* *Validation:* Visualize the Red Channel. Does it glow on complex textures and stay dark on flat walls?

### **Step 3: The Scent Tracker (Linguistic/Fusion)**

* Load CLIP text/image models.  
* Connect the "User Goal" UI input to the worker.  
* Inject the CLIP similarity score into the u\_neuralMap Alpha channel.  
* *Validation:* Type "Find Red". Does red stuff stay sharp in the periphery?

### **Step 4: Optimization (Foveated Inference)**

* Instead of processing the whole screen every frame, process the **Parafovea** (near mouse) at high frequency and the **Far Periphery** at low frequency (1Hz). This mimics the brain's own processing budget.