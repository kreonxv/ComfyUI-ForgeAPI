import { app } from "../../scripts/app.js";

app.registerExtension({
    name: "Forge.Lora.Stack.UI",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "ForgeLoraStack") return;

        nodeType.prototype.applyVisualStyles = function() {
            // Lora-only visual labelling: name-less widget labels are prettified
            this.widgets.forEach(w => {
                if (!w.name || !w.name.startsWith("lora_")) return;
                const parts = w.name.split("_");
                if (w.type === "button") w.label = "❌ Remove LoRA";
                else w.label = parts.slice(2).map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(" ");
            });
        };

        // Initialize a background sync once to copy forge_url from a ForgeSampler
        // to ForgeLoraStack nodes when available.
        if (!app._forgeSamplerUrlSyncInitialized) {
            app._forgeSamplerUrlSyncInitialized = true;
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
                        if (n.type !== "ForgeLoraStack" && n.name !== "ForgeLoraStack") continue;
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

            // Remove any auto-created lora_* widgets BEFORE adding buttons
            if (this.widgets) {
                this.widgets = this.widgets.filter(w => !w.name || !w.name.startsWith("lora_"));
            }

            this.addWidget("button", "➕ Add LoRA", null, () => { this.addLoraSlot(); });

            this.addWidget("button", "🗑️ Clear All", null, () => {
                const base = ["enabled", "forge_url"];
                this.widgets = this.widgets.filter(w => base.includes(w.name) || (w.type === "button" && !w.name.includes("_remove")));
                this.applyVisualStyles();
                this.autoSizeHeight();
            });

            // Hide the forge_url widget visually while keeping it for backend use
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

        // Serialize function - saves the state
        nodeType.prototype.onSerialize = function(o) {
            o.lora_slots = [];
            const loraWidgets = this.widgets.filter(w => w.name && w.name.startsWith("lora_"));
            
            // Group by LoRA index
            const indices = new Set();
            loraWidgets.forEach(w => {
                const m = w.name.match(/^lora_(\d+)_/);
                if (m) indices.add(m[1]);
            });
            
            indices.forEach(idx => {
                const slot = { index: idx };
                loraWidgets.forEach(w => {
                    if (w.name.startsWith(`lora_${idx}_`)) {
                        const param = w.name.replace(`lora_${idx}_`, '');
                        if (param !== 'remove') {
                            slot[param] = w.value;
                        }
                    }
                });
                o.lora_slots.push(slot);
            });
        };

        // Deserialize function - restores the state
        nodeType.prototype.onConfigure = function(o) {
            if (o.lora_slots && Array.isArray(o.lora_slots)) {
                // Clear existing LoRA slots first
                this.widgets = this.widgets.filter(w => !w.name || !w.name.startsWith("lora_"));
                
                // Restore each slot
                o.lora_slots.forEach(slot => {
                    const idx = slot.index;
                    const id = `lora_${idx}`;
                    
                    const nameWidget = this.addWidget("combo", `${id}_name`, slot.name || "None", () => {}, { 
                        values: ["None"] 
                    });
                    
                    this.addWidget("number", `${id}_strength`, slot.strength !== undefined ? slot.strength : 1.0, () => {}, { 
                        min: -10.0, max: 10.0, step: 0.05, precision: 2 
                    });

                    try {
                        const base = `${location.protocol}//127.0.0.1:7860`;
                        fetch(`${base}/sdapi/v1/loras`).then(r => {
                            if (!r.ok) return null;
                            return r.json();
                        }).then(data => {
                            if (!data) return;
                            const vals = ["None"].concat((Array.isArray(data) ? data.map(d => d.name) : []).filter(Boolean));
                            nameWidget.options = nameWidget.options || {};
                            nameWidget.options.values = vals;
                            this.applyVisualStyles();
                            app.canvas.setDirty(true, true);
                        }).catch(() => {});
                    } catch (e) {}

                    this.addWidget("button", `${id}_remove`, null, () => {
                        this.widgets = this.widgets.filter(w => !w.name.startsWith(id));
                        this.applyVisualStyles();
                        this.autoSizeHeight();
                    });
                });
                
                this.finalizeAddition();
            }
        };

        nodeType.prototype.addLoraSlot = function() {
            const existing = this.widgets.filter(w => w.name && w.name.startsWith("lora_"));
            let maxIndex = 0;
            for (const w of existing) {
                const m = w.name.match(/^lora_(\d+)_/);
                if (m) {
                    const v = parseInt(m[1], 10);
                    if (!Number.isNaN(v) && v > maxIndex) maxIndex = v;
                }
            }
            const index = maxIndex + 1;
            const id = `lora_${index}`;

            const nameWidget = this.addWidget("combo", `${id}_name`, "None", () => {}, { values: ["None"] });
            this.addWidget("number", `${id}_strength`, 1.0, () => {}, { min: -10.0, max: 10.0, step: 0.05, precision: 2 });

            try {
                const base = `${location.protocol}//127.0.0.1:7860`;
                fetch(`${base}/sdapi/v1/loras`).then(r => {
                    if (!r.ok) return null;
                    return r.json();
                }).then(data => {
                    if (!data) return;
                    const vals = ["None"].concat((Array.isArray(data) ? data.map(d => d.name) : []).filter(Boolean));
                    nameWidget.options = nameWidget.options || {};
                    nameWidget.options.values = vals;
                    this.applyVisualStyles();
                    app.canvas.setDirty(true, true);
                }).catch(() => {});
            } catch (e) {}

            this.addWidget("button", `${id}_remove`, null, () => {
                this.widgets = this.widgets.filter(w => !w.name.startsWith(id));
                this.applyVisualStyles();
                this.autoSizeHeight();
            });
            this.finalizeAddition();
        };

        nodeType.prototype.finalizeAddition = function() {
            this.applyVisualStyles();
            const btns = this.widgets.filter(w => w.type === "button" && (w.name?.includes("➕") || w.name === "🗑️ Clear All"));
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