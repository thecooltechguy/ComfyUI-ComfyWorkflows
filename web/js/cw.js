import { app } from "../../../scripts/app.js";
import { api } from '../../../scripts/api.js'
import {defaultGraph} from "../../../scripts/defaultGraph.js";
// import { ComfyWidgets } from "../../../scripts/widgets.js"
import { ComfyDialog, $el } from "../../../scripts/ui.js";
// import { ShareDialog, SUPPORTED_OUTPUT_NODE_TYPES, getPotentialOutputsAndOutputNodes } from "./comfyui-share.js";

var docStyle = document.createElement('style');

//   flex-wrap: wrap;
docStyle.innerHTML = `
.cw3-menu-container {
  column-gap: 20px;
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.cw3-menu-column {
  display: flex;
  flex-direction: column;
}

.cw3-title {
	padding: 10px 10px 0 10p;
	background-color: black;
	text-align: center;
	height: 45px;
}
.cw3-export-title {
	padding: 10px 10px 0 10p;
	background-color: black;
	text-align: center;
	height: 75px;
}
`;

document.head.appendChild(docStyle);

var badge_mode = "none";

// copied style from https://github.com/pythongosssss/ComfyUI-Custom-Scripts
const style = `
#comfyworkflows-button {
	position: relative;
	overflow: hidden;
 } 
.pysssss-workflow-arrow-2 {
   position: absolute;
   top: 0;
   bottom: 0;
   right: 0;
   font-size: 12px;
   display: flex;
   align-items: center;
   width: 24px;
   justify-content: center;
   background: rgba(255,255,255,0.1);
   content: "▼";
}
.pysssss-workflow-arrow-2:after {
	content: "▼";
 }
 .pysssss-workflow-arrow-2:hover {
	filter: brightness(1.6);
	background-color: var(--comfy-menu-bg);
 }
.pysssss-workflow-popup-2 ~ .litecontextmenu {
	transform: scale(1.3);
}
#comfyworkflows-button-menu {
	z-index: 10000000000 !important;
}
`;


export var cw_instance = null;
export var cw_import_instance = null;
export var cw_export_instance = null;

export function setCWInstance(obj) {
	cw_instance = obj;
}

export function setCWImportInstance(obj) {
	cw_import_instance = obj;
}

export function setCWExportInstance(obj) {
	cw_export_instance = obj;
}

async function fetchNicknames() {
	const response1 = await api.fetchApi(`/customnode/getmappings?mode=local`);
	const mappings = await response1.json();

	let result = {};

	for (let i in mappings) {
		let item = mappings[i];
		var nickname;
		if (item[1].title) {
			nickname = item[1].title;
		}
		else {
			nickname = item[1].title_aux;
		}

		for (let j in item[0]) {
			result[item[0][j]] = nickname;
		}
	}

	return result;
}

let nicknames = await fetchNicknames();


function newDOMTokenList(initialTokens) {
	const tmp = document.createElement(`div`);

	const classList = tmp.classList;
	if (initialTokens) {
		initialTokens.forEach(token => {
			classList.add(token);
		});
	}

	return classList;
}

const NODE_TYPE_X_NODE_DATA = {};


// -----------
class CWMenuDialog extends ComfyDialog {
	static cw_sharekey = "";

	constructor() {
		super();

		this.code_input = $el("input", {
			type: "text",
			placeholder: "Enter your workflow's code here",
			required: true
		}, []);

		this.final_message = $el("div", {
			style: {
				color: "white",
				textAlign: "center",
				// marginTop: "10px",
				// backgroundColor: "black",
				padding: "10px",
			}
		}, []);

		this.deploy_button = $el("button", {
			type: "submit",
			textContent: "Upload workflow",
			style: {
				backgroundColor: "blue"
			}
		}, []);

		const close_button = $el("button", {
			type: "button", textContent: "Close", onclick: () => {
				// Reset state
				this.deploy_button.textContent = "Upload workflow";
				this.deploy_button.style.display = "inline-block";
				this.final_message.innerHTML = "";
				this.final_message.style.color = "white";
				this.code_input.value = "";
				this.close()
			}
		});

		const content =
			$el("div.cw3-menu-container", //"div.comfy-modal-content",
				[
					$el("tr.cw3-title", {
						width: "100%", style: {
							padding: "10px 10px 10px 10px",
						}
					}, [
						$el("font", { size: 6, color: "white" }, [`Upload your workflow to ComfyWorkflows.com`]),
						$el("br", {}, []),
						$el("font", { size: 3, color: "white" }, [`This lets people easily run your workflow online & on their computer.`]),
					]),
					$el("br", {}, []),

					// add "share key" input (required), "title" input (required), "description" input (optional)
					// $el("div.cw3-menu-container", {width:"100%"}, [
					$el("div.cw3-menu-container", [
						$el("p", { size: 3, color: "white", style: { color: "white" } }, ["Follow these steps to upload your workflow:"]),
						$el("ol", { style: { color: "white" } }, [
							$el("li", {}, ["Share your workflow online at ComfyWorkflows.com."]),
							$el("li", {}, ["Go to your workflow's URL"]),
							$el("li", {}, ["Click the 'Enable online workflow' or 'Update online workflow' button on the workflow's page."]),
							$el("li", {}, ["Copy the code shown and paste it below."]),
						]),
						$el("br", {}, []),
						$el("h4", {
							textContent: "Your workflow's code",
							size: 3,
							color: "white",
							style: {
								color: 'white'
							}
						}, []),
						this.code_input,
						$el("br", {}, []),

						this.final_message,
						$el("br", {}, []),

					]),
					this.deploy_button,
					close_button,
				],
			);

		this.deploy_button.onclick = async () => {
			if (!this.code_input.value) {
				alert("Please enter your workflow's code.");
				return;
			}

			const prompt = await app.graphToPrompt();

			const workflowNodes = prompt.workflow.nodes;
			const filteredNodeTypeToNodeData = {};
			for (const workflowNode of workflowNodes) {
				const workflowNodeData = NODE_TYPE_X_NODE_DATA[workflowNode.type];
				if (workflowNodeData) {
					filteredNodeTypeToNodeData[workflowNode.type] = workflowNodeData;
				}
			}

			// Change the text of the share button to "Sharing..." to indicate that the share process has started
			this.deploy_button.textContent = "Uploading...";
			this.final_message.style.color = "white"; //"green";
			const initialFinalMessage = "This may take a few minutes. Please do not close this window. See the console for upload progress.";
			this.final_message.innerHTML = initialFinalMessage;

			// set an interval to call /cw/deploy_progress every 1 second to get the upload progress and set the text of the final message
			// cancel the interval once the /cw/deploy endpoint returns a response

			const deployProgressInterval = setInterval(async () => {
				const deployProgressResp = await api.fetchApi(`/cw/upload_progress`, {
					method: 'GET',
					headers: { 'Content-Type': 'application/json' },
				});

				if (deployProgressResp.status == 200) {
					try {
						const deployProgressResp_json = await deployProgressResp.json();
						const statusText = deployProgressResp_json.status;
						if (statusText) {
							this.final_message.innerHTML = initialFinalMessage + "<br/><br/>" + statusText;
						}
					} catch (e) {
						// console.log(e);
					}
				}
			}, 1_000);

			const response = await api.fetchApi(`/cw/upload`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					code: this.code_input.value,
					prompt,
					filteredNodeTypeToNodeData
				})
			});

			clearInterval(deployProgressInterval);

			if (response.status != 200) {
				try {
					const response_json = await response.json();
					if (response_json.error) {
						alert(response_json.error);
						this.deploy_button.textContent = "Upload workflow";
						this.deploy_button.style.display = "inline-block";
						this.final_message.innerHTML = "";
						this.final_message.style.color = "white";
						this.code_input.value = "";
						this.close();
						return;
					} else {
						alert("Failed to upload your workflow. Please try again.");
						this.deploy_button.textContent = "Upload workflow";
						this.deploy_button.style.display = "inline-block";
						this.final_message.innerHTML = "";
						this.final_message.style.color = "white";
						this.code_input.value = "";
						this.close();
						return;
					}
				} catch (e) {
					alert("Failed to upload your workflow. Please try again.");
					this.deploy_button.textContent = "Upload workflow";
					this.deploy_button.style.display = "inline-block";
					this.final_message.innerHTML = "";
					this.final_message.style.color = "white";
					this.code_input.value = "";
					this.close();
					return;
				}
			}

			const response_json = await response.json();

			if (response_json.deploy_url) {
				this.final_message.innerHTML = "Your workflow has been uploaded! Now, anyone can run your workflow online at: <a style='color:#ffffff;' href='" + response_json.deploy_url + "' target='_blank'>" + response_json.deploy_url + "</a>";
			}

			this.final_message.style.color = "white"; //"green";

			// hide the share button
			this.deploy_button.textContent = "Uploaded!";
			this.deploy_button.style.display = "none";
		}


		content.style.width = '100%';
		content.style.height = '100%';

		this.element = $el("div.comfy-modal", { parent: document.body }, [content]);
		this.element.style.width = '1000px';
		// this.element.style.height = '400px';
		this.element.style.zIndex = 10000;
	}

	show() {
		this.element.style.display = "block";
	}
}



class CWExportMenuDialog extends ComfyDialog {
	constructor() {
		super();

		this.final_message = $el("div", {
			style: {
				color: "white",
				textAlign: "center",
				// marginTop: "10px",
				// backgroundColor: "black",
				padding: "10px",
			}
		}, []);

		this.deploy_button = $el("button", {
			type: "submit",
			textContent: "Export workflow",
			style: {
				backgroundColor: "blue"
			}
		}, []);

		const close_button = $el("button", {
			type: "button", textContent: "Close", onclick: () => {
				// Reset state
				this.deploy_button.textContent = "Export workflow";
				this.deploy_button.style.display = "inline-block";
				this.final_message.innerHTML = "";
				this.final_message.style.color = "white";
				this.close()
			}
		});

		const content =
			$el("div.cw3-menu-container", //"div.comfy-modal-content",
				[
					$el("tr.cw3-export-title", {
						width: "100%", style: {
							padding: "10px 10px 10px 10px",
						}
					}, [
						$el("font", { size: 6, color: "white" }, [`Export your workflow`]),
						$el("br", {}, []),
						$el("font", { size: 3, color: "white" }, [`This will let anyone import & run this workflow with ZERO setup, using ComfyUI-Launcher.`]),
						$el("br", {}, []),
						// https://github.com/thecooltechguy/ComfyUI-Launcher
						$el("font", { size: 2, color: "white" }, ["https://github.com/thecooltechguy/ComfyUI-Launcher"]),
					]),
					$el("br", {}, []),
					this.final_message,
					$el("br", {}, []),
					this.deploy_button,
					close_button,
				],
			);

		this.deploy_button.onclick = async () => {
			const prompt = await app.graphToPrompt();

			const workflowNodes = prompt.workflow.nodes;
			const filteredNodeTypeToNodeData = {};
			for (const workflowNode of workflowNodes) {
				const workflowNodeData = NODE_TYPE_X_NODE_DATA[workflowNode.type];
				if (workflowNodeData) {
					filteredNodeTypeToNodeData[workflowNode.type] = workflowNodeData;
				}
			}

			// Change the text of the share button to "Sharing..." to indicate that the share process has started
			this.deploy_button.textContent = "Exporting...";
			this.final_message.style.color = "white"; //"green";
			const initialFinalMessage = "This may take a few minutes. Please do not close this window. See the console for the export progress.";
			this.final_message.innerHTML = initialFinalMessage;

			// set an interval to call /cw/export_progress every 1 second to get the export progress and set the text of the final message
			// cancel the interval once the /cw/export endpoint returns a response

			const deployProgressInterval = setInterval(async () => {
				const deployProgressResp = await api.fetchApi(`/cw/export_progress`, {
					method: 'GET',
					headers: { 'Content-Type': 'application/json' },
				});

				if (deployProgressResp.status == 200) {
					try {
						const deployProgressResp_json = await deployProgressResp.json();
						const statusText = deployProgressResp_json.status;
						if (statusText) {
							this.final_message.innerHTML = initialFinalMessage + "<br/><br/>" + statusText;
						}
					} catch (e) {
						// console.log(e);
					}
				}
			}, 1_000);

			const response = await api.fetchApi(`/cw/export`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					prompt,
					filteredNodeTypeToNodeData
				})
			});

			clearInterval(deployProgressInterval);

			if (response.status != 200) {
				try {
					const response_json = await response.json();
					if (response_json.error) {
						alert(response_json.error);
						this.deploy_button.textContent = "Export workflow";
						this.deploy_button.style.display = "inline-block";
						this.final_message.innerHTML = "";
						this.final_message.style.color = "white";
						this.close();
						return;
					} else {
						alert("Failed to export your workflow. Please try again.");
						this.deploy_button.textContent = "Export workflow";
						this.deploy_button.style.display = "inline-block";
						this.final_message.innerHTML = "";
						this.final_message.style.color = "white";
						this.close();
						return;
					}
				} catch (e) {
					alert("Failed to export your workflow. Please try again.");
					this.deploy_button.textContent = "Export workflow";
					this.deploy_button.style.display = "inline-block";
					this.final_message.innerHTML = "";
					this.final_message.style.color = "white";
					this.close();
					return;
				}
			}

			const response_json = await response.json();

			// trigger a download of a json file containing the response_json as content
			const blob = new Blob([JSON.stringify(response_json)], { type: 'application/json' });
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = 'comfyui-launcher.json';
			document.body.appendChild(a);
			a.click();
			a.remove();
			URL.revokeObjectURL(url);

			this.final_message.innerHTML = "Your workflow has been exported & downloaded to your computer (as a comfyui-launcher.json file). Now, anyone can run your workflow with ZERO setup using ComfyUI-Launcher.";
			this.final_message.style.color = "white"; //"green";

			// hide the share button
			this.deploy_button.textContent = "Exported!";
			this.deploy_button.style.display = "none";
		}


		content.style.width = '100%';
		content.style.height = '100%';

		this.element = $el("div.comfy-modal", { parent: document.body }, [content]);
		this.element.style.width = '1000px';
		// this.element.style.height = '400px';
		this.element.style.zIndex = 10000;
	}

	show() {
		this.element.style.display = "block";
	}
}




app.registerExtension({
	name: "ComfyUI.ComfyWorkflows",
	init() {
		$el("style", {
			textContent: style,
			parent: document.head,
		});
	},
	async setup() {
		// console.log(JSON.stringify(NODE_TYPE_X_NODE_DATA));
		const menu = document.querySelector(".comfy-menu");
		const separator = document.createElement("hr");

		separator.style.margin = "20px 0";
		separator.style.width = "100%";
		menu.append(separator);

		const deployButton = document.createElement("button");
		deployButton.textContent = "Upload to ComfyWorkflows";
		deployButton.onclick = () => {
			if (!cw_instance)
				setCWInstance(new CWMenuDialog());
			cw_instance.show();
		}
		menu.append(deployButton);

		const exportButton = document.createElement("button");
		exportButton.textContent = "Export workflow (Launcher)";
		exportButton.onclick = () => {
			if (!cw_export_instance)
				setCWExportInstance(new CWExportMenuDialog());
			cw_export_instance.show();
		}
		menu.append(exportButton);

		// if this is the first time the user is opening this project, load the default graph for this project
		// this is necessary because the user may have previously run a different comfyui on the same port as this project, so the local storage would have that workflow's graph
		const res = await api.fetchApi(`/cw/current_graph`, {
			method: 'GET',
			headers: { 'Content-Type': 'application/json' },
		});
		if (res.status === 200) {
			const res_json = await res.json();
			if (res_json) {
				await app.loadGraphData(res_json);
			} else {
				await app.loadGraphData(defaultGraph);
			}

			// note how we only start the interval to save the graph to the server after the graph has been loaded initially
			setInterval(async () => {
				const graph = await app.graphToPrompt();
				const res = await api.fetchApi(`/cw/save_graph`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(graph['workflow']),
				});
				console.log("Saved graph to server: " + res.status);
			}, 1_000);
		} else {
			await app.loadGraphData(defaultGraph);
		}
	},

	async beforeRegisterNodeDef(nodeType, nodeData, app) {
		NODE_TYPE_X_NODE_DATA[nodeData.name] = nodeData;

		const onDrawForeground = nodeType.prototype.onDrawForeground;
		nodeType.prototype.onDrawForeground = function (ctx) {
			const r = onDrawForeground?.apply?.(this, arguments);

			if (!this.flags.collapsed && badge_mode != 'none' && nodeType.title_mode != LiteGraph.NO_TITLE) {
				let text = "";
				if (badge_mode == 'id_nick')
					text = `#${this.id} `;

				if (nicknames[nodeData.name.trim()]) {
					let nick = nicknames[nodeData.name.trim()];

					if (nick.length > 25) {
						text += nick.substring(0, 23) + "..";
					}
					else {
						text += nick;
					}
				}

				if (text != "") {
					let fgColor = "white";
					let bgColor = "#0F1F0F";
					let visible = true;

					ctx.save();
					ctx.font = "12px sans-serif";
					const sz = ctx.measureText(text);
					ctx.fillStyle = bgColor;
					ctx.beginPath();
					ctx.roundRect(this.size[0] - sz.width - 12, -LiteGraph.NODE_TITLE_HEIGHT - 20, sz.width + 12, 20, 5);
					ctx.fill();

					ctx.fillStyle = fgColor;
					ctx.fillText(text, this.size[0] - sz.width - 6, -LiteGraph.NODE_TITLE_HEIGHT - 6);
					ctx.restore();
				}
			}
			return r;
		};
	},

	async loadedGraphNode(node, app) {
		if (node.has_errors) {
			const onDrawForeground = node.onDrawForeground;
			node.onDrawForeground = function (ctx) {
				const r = onDrawForeground?.apply?.(this, arguments);

				if (!this.flags.collapsed && badge_mode != 'none') {
					let text = "";
					if (badge_mode == 'id_nick')
						text = `#${this.id} `;

					if (nicknames[node.type.trim()]) {
						let nick = nicknames[node.type.trim()];

						if (nick.length > 25) {
							text += nick.substring(0, 23) + "..";
						}
						else {
							text += nick;
						}
					}

					if (text != "") {
						let fgColor = "white";
						let bgColor = "#0F1F0F";
						let visible = true;

						ctx.save();
						ctx.font = "12px sans-serif";
						const sz = ctx.measureText(text);
						ctx.fillStyle = bgColor;
						ctx.beginPath();
						ctx.roundRect(this.size[0] - sz.width - 12, -LiteGraph.NODE_TITLE_HEIGHT - 20, sz.width + 12, 20, 5);
						ctx.fill();

						ctx.fillStyle = fgColor;
						ctx.fillText(text, this.size[0] - sz.width - 6, -LiteGraph.NODE_TITLE_HEIGHT - 6);
						ctx.restore();

						ctx.save();
						ctx.font = "bold 14px sans-serif";
						const sz2 = ctx.measureText(node.type);
						ctx.fillStyle = 'white';
						ctx.fillText(node.type, this.size[0] / 2 - sz2.width / 2, this.size[1] / 2);
						ctx.restore();
					}
				}

				return r;
			};
		}
	}
});
