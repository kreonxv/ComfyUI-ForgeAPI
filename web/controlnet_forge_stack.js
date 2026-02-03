import { app } from "../../scripts/app.js";

app.registerExtension({
    name: "Forge.ControlNet.Stack.UI",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "ForgeControlNetStack") return;

        nodeType.prototype.applyVisualStyles = function() {
            // Apply visual labels to all widgets
            this.widgets.forEach(w => {
                if (!w.name || !w.name.startsWith("cn_")) return;
                
                const parts = w.name.split("_");
                if (parts.length < 3) return;
                
                const cnNum = parts[1];  // The index number
                const param = parts.slice(2).join("_");  // The parameter name
                
                // Format parameter name nicely
                const formattedParam = param
                    .split("_")
                    .map(p => p.charAt(0).toUpperCase() + p.slice(1))
                    .join(" ");
                
                if (w.type === "button") {
                    w.label = `❌ Remove CN ${cnNum}`;
                } else {
                    w.label = `CN ${cnNum} ${formattedParam}`;
                }
            });

            // Label inputs
            if (this.inputs) {
                this.inputs.forEach(inp => {
                    if (inp.name && inp.name.startsWith("cn_")) {
                        const parts = inp.name.split("_");
                        const num = parts[1];
                        inp.label = `CN ${num} Image`;
                    }
                });
            }
        };

        // Initialize forge_url sync from ForgeSampler
        if (!app._forgeControlNetUrlSyncInitialized) {
            app._forgeControlNetUrlSyncInitialized = true;
            setInterval(() => {
                try {
                    const findNodes = () => {
                        if (app.canvas && Array.isArray(app.canvas.nodes)) return app.canvas.nodes;
                        if (Array.isArray(app.nodes)) return app.nodes;
                        if (app.canvas && app.canvas.graph && Array.isArray(app.canvas.graph.nodes)) return app.canvas.graph.nodes;
                        return [];
                    };

                    const nodes = findNodes();
                    if (!nodes || !nodes.length) return;

                    const sampler = nodes.find(n => n.type === "ForgeSampler" || n.name === "ForgeSampler");
                    const samplerFW = sampler?.widgets && sampler.widgets.find(w => w.name === "forge_url");
                    const samplerVal = samplerFW?.value || samplerFW?.default || null;
                    if (!samplerVal) return;

                    for (const n of nodes) {
                        if (n.type !== "ForgeControlNetStack" && n.name !== "ForgeControlNetStack") continue;
                        const myW = n.widgets && n.widgets.find(w => w.name === "forge_url");
                        let wrote = false;
                        if (myW) {
                            if (!myW.value || myW.value === myW.default || myW.value === "http://127.0.0.1:7860") {
                                myW.value = samplerVal;
                                wrote = true;
                            }
                        } else {
                            try {
                                n.values = n.values || {};
                                if (!n.values["forge_url"] || n.values["forge_url"] === "http://127.0.0.1:7860") {
                                    n.values["forge_url"] = samplerVal;
                                    wrote = true;
                                }
                            } catch (e) {}
                            try {
                                if (!n._forge_url) {
                                    n._forge_url = samplerVal;
                                    wrote = true;
                                }
                            } catch (e) {}
                        }
                        if (wrote) {
                            n.applyVisualStyles?.();
                            app.canvas.setDirty(true, true);
                        }
                    }
                } catch (e) {}
            }, 1200);
        }

        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            onNodeCreated?.apply(this, arguments);

            // Remove any auto-created cn_* widgets and inputs BEFORE adding our buttons
            if (this.widgets) {
                this.widgets = this.widgets.filter(w => !w.name || !w.name.startsWith("cn_"));
            }
            if (this.inputs) {
                for (let i = this.inputs.length - 1; i >= 0; i--) {
                    if (this.inputs[i].name && this.inputs[i].name.startsWith("cn_")) {
                        this.removeInput(i);
                    }
                }
            }
            
            // Hide all the cn_*_preview outputs (keep only cn_stack visible)
            if (this.outputs) {
                for (let i = this.outputs.length - 1; i >= 1; i--) {
                    const output = this.outputs[i];
                    if (output && output.name && output.name.startsWith("cn_") && output.name.endsWith("_preview")) {
                        // Remove unused outputs on initial load
                        this.removeOutput(i);
                    }
                }
            }

            // Add the "Add ControlNet" button
            this.addWidget("button", "➕ Add ControlNet", null, () => { 
                this.addCNSlot(); 
            });

            // Add the "Clear All" button
            this.addWidget("button", "🗑️ Clear All", null, () => {
                const base = ["enabled", "forge_url"];
                this.widgets = this.widgets.filter(w => 
                    base.includes(w.name) || 
                    (w.type === "button" && !w.name.includes("_remove"))
                );
                
                // Remove all CN inputs
                if (this.inputs) {
                    for (let i = this.inputs.length - 1; i >= 0; i--) {
                        if (this.inputs[i].name.startsWith("cn_")) {
                            this.removeInput(i);
                        }
                    }
                }
                
                // Remove all CN outputs
                if (this.outputs) {
                    for (let i = this.outputs.length - 1; i >= 1; i--) {
                        const output = this.outputs[i];
                        if (output && output.name && output.name.startsWith("cn_") && output.name.endsWith("_preview")) {
                            this.removeOutput(i);
                        }
                    }
                }
                
                this.applyVisualStyles();
                this.autoSizeHeight();
            });
            
            // Hide the forge_url widget
            try {
                const fw = this.widgets.find(w => w.name === "forge_url");
                if (fw) {
                    fw.label = "";
                    fw.hidden = true;
                    fw.visible = false;
                    fw._hidden = true;
                    try { if (fw.dom) fw.dom.style.display = "none"; } catch (e) {}
                    try { if (fw.domElement) fw.domElement.style.display = "none"; } catch (e) {}
                }
            } catch (e) {}

            this.applyVisualStyles();
            this.autoSizeHeight();
        };

        // Handle pass-through of images from inputs to outputs
        nodeType.prototype.onConnectionsChange = function(type, index, connected, link_info) {
            // When an input gets connected, pass it through to the corresponding output
            if (type === 1 && connected && this.inputs && this.outputs) { // type 1 = input
                const input = this.inputs[index];
                if (input && input.name && input.name.endsWith("_image")) {
                    // Find matching output
                    const outputName = input.name.replace("_image", "_preview");
                    const outputIdx = this.outputs.findIndex(o => o.name === outputName);
                    if (outputIdx !== -1) {
                        // Store reference for pass-through
                        if (!this._imagePassthrough) this._imagePassthrough = {};
                        this._imagePassthrough[outputName] = input.name;
                    }
                }
            }
        };

        // Serialize function - saves the state
        nodeType.prototype.onSerialize = function(o) {
            o.cn_slots = [];
            const cnWidgets = this.widgets.filter(w => w.name && w.name.startsWith("cn_"));
            const cnInputs = this.inputs ? this.inputs.filter(inp => inp.name && inp.name.startsWith("cn_")) : [];
            
            // Group by CN index
            const indices = new Set();
            cnWidgets.forEach(w => {
                const m = w.name.match(/^cn_(\d+)_/);
                if (m) indices.add(m[1]);
            });
            cnInputs.forEach(inp => {
                const m = inp.name.match(/^cn_(\d+)_/);
                if (m) indices.add(m[1]);
            });
            
            indices.forEach(idx => {
                const slot = { index: idx };
                cnWidgets.forEach(w => {
                    if (w.name.startsWith(`cn_${idx}_`)) {
                        const param = w.name.replace(`cn_${idx}_`, '');
                        if (param !== 'remove') {
                            slot[param] = w.value;
                        }
                    }
                });
                o.cn_slots.push(slot);
            });
        };

        // Deserialize function - restores the state
        nodeType.prototype.onConfigure = function(o) {
            if (o.cn_slots && Array.isArray(o.cn_slots)) {
                // Clear existing CN slots first
                this.widgets = this.widgets.filter(w => !w.name || !w.name.startsWith("cn_"));
                if (this.inputs) {
                    for (let i = this.inputs.length - 1; i >= 0; i--) {
                        if (this.inputs[i].name.startsWith("cn_")) {
                            this.removeInput(i);
                        }
                    }
                }
                // Remove all CN outputs
                if (this.outputs) {
                    for (let i = this.outputs.length - 1; i >= 1; i--) {
                        const output = this.outputs[i];
                        if (output && output.name && output.name.startsWith("cn_") && output.name.endsWith("_preview")) {
                            this.removeOutput(i);
                        }
                    }
                }
                
                // Restore each slot
                o.cn_slots.forEach(slot => {
                    const idx = slot.index;
                    const id = `cn_${idx}`;
                    
                    // Add input
                    this.addInput(`${id}_image`, "IMAGE");
                    
                    // Add output
                    this.addOutput(`${id}_preview`, "IMAGE");
                    
                    // Add widgets with saved values
                    const modelWidget = this.addWidget("combo", `${id}_model`, slot.model || "None", () => {}, { 
                        values: ["None"] 
                    });
                    
                    const preprocessorWidget = this.addWidget("combo", `${id}_preprocessor`, slot.preprocessor || "none", () => {}, { 
                        values: ["none"] 
                    });
                    
                    this.addWidget("number", `${id}_weight`, slot.weight !== undefined ? slot.weight : 1.0, () => {}, { 
                        min: 0, max: 2, step: 0.05, precision: 2 
                    });
                    
                    this.addWidget("number", `${id}_start`, slot.start !== undefined ? slot.start : 0.0, () => {}, { 
                        min: 0, max: 1, step: 0.01, precision: 2 
                    });
                    
                    this.addWidget("number", `${id}_end`, slot.end !== undefined ? slot.end : 1.0, () => {}, { 
                        min: 0, max: 1, step: 0.01, precision: 2 
                    });
                    
                    this.addWidget("number", `${id}_resolution`, slot.resolution !== undefined ? slot.resolution : 512, () => {}, { 
                        min: 64, max: 2048, step: 64 
                    });
                    
                    const thresholdAWidget = this.addWidget("number", `${id}_threshold_a`, slot.threshold_a !== undefined ? slot.threshold_a : 100, () => {}, { 
                        min: 0, max: 255, step: 1 
                    });
                    
                    const thresholdBWidget = this.addWidget("number", `${id}_threshold_b`, slot.threshold_b !== undefined ? slot.threshold_b : 200, () => {}, { 
                        min: 0, max: 255, step: 1 
                    });
                    
                    // Show/hide thresholds based on saved preprocessor value
                    const shouldShowThresholds = slot.preprocessor === "canny";
                    thresholdAWidget.hidden = !shouldShowThresholds;
                    thresholdBWidget.hidden = !shouldShowThresholds;
                    
                    // Add callback to preprocessor to show/hide thresholds based on selection
                    preprocessorWidget.callback = () => {
                        const selectedPreprocessor = preprocessorWidget.value;
                        const shouldShow = selectedPreprocessor === "canny";
                        thresholdAWidget.hidden = !shouldShow;
                        thresholdBWidget.hidden = !shouldShow;
                        // CHANGED: Use autoSizeHeight to preserve width
                        this.autoSizeHeight();
                    };
                    
                    this.addWidget("combo", `${id}_control_mode`, slot.control_mode || "Balanced", () => {}, { 
                        values: ["Balanced", "My prompt is more important", "ControlNet is more important"] 
                    });
                    
                    // Fetch available models and preprocessors
                    try {
                        const base = 'http://127.0.0.1:7860';
                        
                        fetch(`${base}/controlnet/model_list`)
                            .then(r => r.ok ? r.json() : null)
                            .then(data => {
                                if (!data || !data.model_list) return;
                                const vals = ["None"].concat(data.model_list.filter(Boolean));
                                modelWidget.options = modelWidget.options || {};
                                modelWidget.options.values = vals;
                                this.applyVisualStyles();
                                app.canvas.setDirty(true, true);
                            })
                            .catch(() => {});
                        
                        fetch(`${base}/controlnet/module_list`)
                            .then(r => r.ok ? r.json() : null)
                            .then(data => {
                                if (!data || !data.module_list) return;
                                const vals = ["none"].concat(data.module_list.filter(Boolean));
                                preprocessorWidget.options = preprocessorWidget.options || {};
                                preprocessorWidget.options.values = vals;
                                this.applyVisualStyles();
                                app.canvas.setDirty(true, true);
                            })
                            .catch(() => {});
                    } catch (e) {}
                    
                    // Add remove button
                    this.addWidget("button", `${id}_remove`, null, () => {
                        const inputIdx = this.inputs.findIndex(inp => inp.name === `${id}_image`);
                        if (inputIdx !== -1) {
                            this.removeInput(inputIdx);
                        }
                        const outputIdx = this.outputs.findIndex(out => out.name === `${id}_preview`);
                        if (outputIdx !== -1) {
                            this.removeOutput(outputIdx);
                        }
                        this.widgets = this.widgets.filter(w => !w.name || !w.name.startsWith(id));
                        this.applyVisualStyles();
                        this.autoSizeHeight();
                    });
                });
                
                this.finalizeAddition();
            }
        };

        nodeType.prototype.addCNSlot = function() {
            // Find the highest existing CN index
            const existing = this.widgets.filter(w => w.name && w.name.startsWith("cn_"));
            let maxIndex = 0;
            for (const w of existing) {
                const m = w.name.match(/^cn_(\d+)_/);
                if (m) {
                    const v = parseInt(m[1], 10);
                    if (!Number.isNaN(v) && v > maxIndex) maxIndex = v;
                }
            }
            const index = maxIndex + 1;
            const id = `cn_${index}`;

            // Add image input
            this.addInput(`${id}_image`, "IMAGE");
            
            // Add the corresponding output for processed image
            this.addOutput(`${id}_preview`, "IMAGE");

            // Add widgets
            const modelWidget = this.addWidget("combo", `${id}_model`, "None", () => {}, { 
                values: ["None"] 
            });
            
            const preprocessorWidget = this.addWidget("combo", `${id}_preprocessor`, "none", () => {}, { 
                values: ["none"] 
            });
            
            this.addWidget("number", `${id}_weight`, 1.0, () => {}, { 
                min: 0, max: 2, step: 0.05, precision: 2 
            });
            
            this.addWidget("number", `${id}_start`, 0.0, () => {}, { 
                min: 0, max: 1, step: 0.01, precision: 2 
            });
            
            this.addWidget("number", `${id}_end`, 1.0, () => {}, { 
                min: 0, max: 1, step: 0.01, precision: 2 
            });
            
            this.addWidget("number", `${id}_resolution`, 512, () => {}, { 
                min: 64, max: 2048, step: 64 
            });
            
            const thresholdAWidget = this.addWidget("number", `${id}_threshold_a`, 100, () => {}, { 
                min: 0, max: 255, step: 1 
            });
            
            const thresholdBWidget = this.addWidget("number", `${id}_threshold_b`, 200, () => {}, { 
                min: 0, max: 255, step: 1 
            });
            
            // Initially hide threshold widgets
            thresholdAWidget.hidden = true;
            thresholdBWidget.hidden = true;
            
            // Add callback to preprocessor to show/hide thresholds based on selection
            preprocessorWidget.callback = () => {
                const selectedPreprocessor = preprocessorWidget.value;
                const shouldShowThresholds = selectedPreprocessor === "canny";
                thresholdAWidget.hidden = !shouldShowThresholds;
                thresholdBWidget.hidden = !shouldShowThresholds;
                // CHANGED: Use autoSizeHeight to preserve width
                this.autoSizeHeight();
            };
            
            this.addWidget("combo", `${id}_control_mode`, "Balanced", () => {}, { 
                values: ["Balanced", "My prompt is more important", "ControlNet is more important"] 
            });

            // Fetch available models and preprocessors
            try {
                const base = 'http://127.0.0.1:7860';
                
                // Fetch models
                fetch(`${base}/controlnet/model_list`)
                    .then(r => r.ok ? r.json() : null)
                    .then(data => {
                        if (!data || !data.model_list) return;
                        const vals = ["None"].concat(data.model_list.filter(Boolean));
                        modelWidget.options = modelWidget.options || {};
                        modelWidget.options.values = vals;
                        this.applyVisualStyles();
                        app.canvas.setDirty(true, true);
                    })
                    .catch(() => {});
                
                // Fetch preprocessors
                fetch(`${base}/controlnet/module_list`)
                    .then(r => r.ok ? r.json() : null)
                    .then(data => {
                        if (!data || !data.module_list) return;
                        const vals = ["none"].concat(data.module_list.filter(Boolean));
                        preprocessorWidget.options = preprocessorWidget.options || {};
                        preprocessorWidget.options.values = vals;
                        this.applyVisualStyles();
                        app.canvas.setDirty(true, true);
                    })
                    .catch(() => {});
            } catch (e) {}

            // Add remove button
            this.addWidget("button", `${id}_remove`, null, () => {
                // Remove the input
                const inputIdx = this.inputs.findIndex(inp => inp.name === `${id}_image`);
                if (inputIdx !== -1) {
                    this.removeInput(inputIdx);
                }
                
                // Remove the output
                const outputIdx = this.outputs.findIndex(out => out.name === `${id}_preview`);
                if (outputIdx !== -1) {
                    this.removeOutput(outputIdx);
                }
                
                // Remove all widgets for this CN
                this.widgets = this.widgets.filter(w => !w.name || !w.name.startsWith(id));
                
                this.applyVisualStyles();
                this.autoSizeHeight();
            });

            this.finalizeAddition();
        };

        nodeType.prototype.finalizeAddition = function() {
            this.applyVisualStyles();
            
            // Move action buttons to the end
            const btns = this.widgets.filter(w => 
                w.type === "button" && 
                (w.name?.includes("➕") || w.name === "🗑️ Clear All")
            );
            this.widgets = this.widgets.filter(w => !btns.includes(w)).concat(btns);
            
            this.autoSizeHeight();
        };

        nodeType.prototype.autoSizeHeight = function() {
            const size = this.computeSize();
            this.setSize([this.size[0], size[1]]);
            app.canvas.setDirty(true, true);
        };
    }
});