SCHEMA_VERSION = "1.0"

def generate_export_json_file(workflow_json, snapshot_json, files_data, pip_reqs, os_type, python_version):
    return {
        "format" : "comfyui_launcher",
        "version" : SCHEMA_VERSION,
        "workflow_json" : workflow_json,
        "snapshot_json" : snapshot_json,
        "files" : files_data,
        "pip_requirements" : pip_reqs,
        "os" : os_type,
        "python_version" : python_version
    }