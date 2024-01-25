import hashlib
import io
import json
import os
import time
from typing import Callable

import aiohttp
import git
from aiohttp import web
from aiohttp_retry import ExponentialRetry, RetryClient
from tqdm.asyncio import tqdm

import folder_paths
import server
import os

NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}

WEB_DIRECTORY = "./web"
__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]

comfy_path = os.path.dirname(folder_paths.__file__)
custom_nodes_path = os.path.join(comfy_path, 'custom_nodes')

CW_ENDPOINT = os.environ.get("CW_ENDPOINT", "https://comfyworkflows.com")

import re
import unicodedata

def slugify(value, allow_unicode=False):
    """
    Taken from https://github.com/django/django/blob/master/django/utils/text.py
    Convert to ASCII if 'allow_unicode' is False. Convert spaces or repeated
    dashes to single dashes. Remove characters that aren't alphanumerics,
    underscores, or hyphens. Convert to lowercase. Also strip leading and
    trailing whitespace, dashes, and underscores.
    """
    value = str(value)
    if allow_unicode:
        value = unicodedata.normalize('NFKC', value)
    else:
        value = unicodedata.normalize('NFKD', value).encode('ascii', 'ignore').decode('ascii')
    value = re.sub(r'[^\w\s-]', '', value.lower())
    return re.sub(r'[-\s]+', '-', value).strip('-_')


def get_current_snapshot():
    # Get ComfyUI hash (credit to ComfyUI-Manager for this function)
    repo_path = os.path.dirname(folder_paths.__file__)

    if not os.path.exists(os.path.join(repo_path, '.git')):
        print(f"ComfyUI update fail: The installed ComfyUI does not have a Git repository.")
        return web.Response(status=400)

    repo = git.Repo(repo_path)
    comfyui_commit_hash = repo.head.commit.hexsha

    git_custom_nodes = {}
    file_custom_nodes = []

    # Get custom nodes hash
    for path in os.listdir(custom_nodes_path):
        fullpath = os.path.join(custom_nodes_path, path)

        if os.path.isdir(fullpath):
            is_disabled = path.endswith(".disabled")

            try:
                git_dir = os.path.join(fullpath, '.git')

                if not os.path.exists(git_dir):
                    continue

                repo = git.Repo(fullpath)
                commit_hash = repo.head.commit.hexsha
                url = repo.remotes.origin.url
                git_custom_nodes[url] = {
                    'hash': commit_hash,
                    'disabled': is_disabled
                }

            except:
                print(f"Failed to extract snapshots for the custom node '{path}'.")

        elif path.endswith('.py'):
            is_disabled = path.endswith(".py.disabled")
            filename = os.path.basename(path)
            item = {
                'filename': filename,
                'disabled': is_disabled
            }

            file_custom_nodes.append(item)

    return {
        'comfyui': comfyui_commit_hash,
        'git_custom_nodes': git_custom_nodes,
        'file_custom_nodes': file_custom_nodes,
    }

def get_file_sha256_checksum(file_path):
    BUF_SIZE = 65536  # lets read stuff in 64kb chunks!
    sha256 = hashlib.sha256()
    with open(file_path, 'rb') as f:
        while True:
            data = f.read(BUF_SIZE)
            if not data:
                break
            sha256.update(data)
    return sha256.hexdigest()

def extract_file_names(json_data):
    """Extract unique file names from the input JSON data."""
    file_names = set()

    # Recursively search for file names in the JSON data
    def recursive_search(data):
        if isinstance(data, dict):
            for value in data.values():
                recursive_search(value)
        elif isinstance(data, list):
            for item in data:
                recursive_search(item)
        elif isinstance(data, str) and '.' in data:
            file_names.add(os.path.basename(data)) # file_names.add(data)

    recursive_search(json_data)
    return list(file_names)

def find_file_paths(base_dir, file_names):
    """Find the paths of the files in the base directory."""
    file_paths = {}

    for root, dirs, files in os.walk(base_dir):
        # Exclude certain directories
        dirs[:] = [d for d in dirs if d not in ['.git']]

        for file in files:
            if file in file_names:
                file_paths[file] = os.path.join(root, file)
    return file_paths


class CallbackBytesIO(io.BytesIO):

    def __init__(self, callback: Callable, initial_bytes: bytes):
        self._callback = callback
        super().__init__(initial_bytes)

    def read(self, size=-1) -> bytes:
        data = super().read(size)
        self._callback(len(data))
        return data

DEPLOY_PROGRESS = {}

@server.PromptServer.instance.routes.get("/cw/upload_progress")
async def api_comfyworkflows_upload_progress(request):
    global DEPLOY_PROGRESS
    return web.json_response(DEPLOY_PROGRESS)

UPLOAD_CHUNK_SIZE = 100_000_000 # 100 MB

def get_num_chunks(file_size):
    global UPLOAD_CHUNK_SIZE
    num_chunks = file_size // UPLOAD_CHUNK_SIZE
    if file_size % UPLOAD_CHUNK_SIZE != 0:
        num_chunks += 1
    return num_chunks

@server.PromptServer.instance.routes.post("/cw/upload")
async def api_comfyworkflows_upload(request):
    global DEPLOY_PROGRESS
    print("Uploading workflow...")
    json_data = await request.json()

    code = json_data['code']
    prompt = json_data['prompt']
    filteredNodeTypeToNodeData = json_data['filteredNodeTypeToNodeData']

    # Example usage
    base_directory = folder_paths.base_path #"./"

    # Parse the JSON
    parsed_json = prompt

    DEPLOY_PROGRESS = {
        "status" : "preparing upload...",
    }

    # TODO: For now, we assume that there are no duplicate files with the same name at 2 or more different paths.

    # Extract file names
    file_names = set(extract_file_names(parsed_json))
    print("File names: ", file_names)

    # Find file paths
    file_paths = find_file_paths(base_directory, file_names)
    print("File paths: ", file_paths)

    all_file_info = {}
    for file_name, file_path in file_paths.items():
        file_checksum = get_file_sha256_checksum(file_path)
        all_file_info[file_name] = {
            'path': file_path,
            'size': os.path.getsize(file_path),
            'dest_relative_path': os.path.relpath(file_path, base_directory),
            'checksum': file_checksum
        }

    total_num_chunks = 0
    for file_name, file_info in all_file_info.items():
        num_chunks = get_num_chunks(file_info['size'])
        total_num_chunks += num_chunks

    DEPLOY_PROGRESS = {
        "status" : "creating snapshot...",
    }

    # Compute snapshot
    snapshot_json = get_current_snapshot()
    # print("Current snapshot json:")
    # print(snapshot_json)

    raise_for_status = {x for x in range(100, 600)}
    raise_for_status.remove(200)
    raise_for_status.remove(429)

    # First, create the runnable workflow object
    async with aiohttp.ClientSession(trust_env=True, connector=aiohttp.TCPConnector(verify_ssl=False)) as session:
        retry_client = RetryClient(session, retry_options=ExponentialRetry(attempts=3), raise_for_status=raise_for_status)

        async with retry_client.post(
            f"{CW_ENDPOINT}/api/runnable-workflows/init_runnable_workflow",
            json={
                "runnable_workflow_key": code, 
                "num_files" : len(all_file_info),
                "workflow_json" : json.dumps(prompt),
                "snapshot_json" : json.dumps(snapshot_json),
                "filteredNodeTypeToNodeData" : json.dumps(filteredNodeTypeToNodeData),
            },
        ) as resp:
            assert resp.status == 200

        # Now, we upload each file
        DEPLOY_PROGRESS = {
            "status" : f"uploading files... (0%)",
        }
        total_num_files = len(all_file_info)
        current_file_index = -1
        num_chunks_uploaded = 0
        for file_name, file_info in all_file_info.items():
            # print(f"Going to upload file: {file_name}...")
            DEPLOY_PROGRESS = {
                "status" : f"uploading files... ({round(100.0 * num_chunks_uploaded / total_num_chunks, 2)}%)",
            }

            num_chunks_for_file = get_num_chunks(file_info['size'])
            current_file_index += 1
            async with retry_client.post(
                f"{CW_ENDPOINT}/api/runnable-workflows/get_presigned_url_for_runnable_workflow_file",
                json={
                    "runnable_workflow_key": code,
                    "dest_relative_path" : file_info['dest_relative_path'],
                    "sha256_checksum": file_info['checksum'],
                    'size': file_info['size'],
                },
            ) as resp:
                assert resp.status == 200
                upload_json = await resp.json()

                if upload_json['uploadFile'] == False:
                    print(f"Skipping file {file_name} because it already exists in the cloud.")
                    num_chunks_uploaded += num_chunks_for_file
                    continue
                
                uploadId = upload_json['uploadId']
                presigned_urls = upload_json['signedUrlsList']
                objectKey = upload_json['objectKey']

                # print(presigned_url)
                # print("Uploading file: {0}".format(file_info['path']))
                t = time.time()
                # headers = {
                #     "Content-Length": str(file_info['size']),
                # }
                # print(headers)
                # progress_bar = tqdm(
                #     desc=f"Uploading {os.path.basename(file_info['path'])}",
                #     unit="B",
                #     unit_scale=True,
                #     total=file_info['size'],
                #     unit_divisor=1024,
                # )

                # with open(file_info['path'], "rb") as f:
                #     file_data = CallbackBytesIO(progress_bar.update, f.read())
                
                parts = []

                progress_bar = tqdm(
                    desc=f"Uploading file ({(current_file_index + 1)}/{total_num_files}) {os.path.basename(file_info['path'])}",
                    unit="B",
                    unit_scale=True,
                    total=file_info['size'],
                    unit_divisor=1024,
                )

                with open(file_info['path'], "rb") as f:
                    chunk_index = 0
                    while True:
                        data = f.read(UPLOAD_CHUNK_SIZE)
                        if not data:
                            # print("Finished uploading file. ", chunk_index, UPLOAD_CHUNK_SIZE)
                            break

                        max_retries = 5
                        num_retries = 0
                        while num_retries < max_retries:
                            try:
                                async with retry_client.put(presigned_urls[chunk_index],data=data) as resp:
                                    assert resp.status == 200
                                    parts.append({
                                        'ETag': resp.headers['ETag'],
                                        'PartNumber': chunk_index + 1,
                                    })
                                    break
                            except:
                                num_retries += 1
                                # print(f"Failed to upload chunk {chunk_index} of file {file_name} to {presigned_urls[chunk_index]}... retrying ({num_retries}/{max_retries})")
                                if num_retries == max_retries:
                                    raise Exception(f"Failed to upload file {os.path.basename(file_info['path'])} after {max_retries} retries.")

                        progress_bar.update(len(data))

                        chunk_index += 1
                        
                        num_chunks_uploaded += 1
                        DEPLOY_PROGRESS = {
                            "status" : f"uploading files... ({round(100.0 * num_chunks_uploaded / total_num_chunks, 2)}%)",
                        }

                # Complete the multipart upload for this file
                async with retry_client.post(
                    f"{CW_ENDPOINT}/api/runnable-workflows/complete_multipart_upload_for_runnable_workflow_file",
                    json={
                        "parts": parts,
                        "objectKey": objectKey,
                        "uploadId": uploadId,
                        "runnable_workflow_key": code,
                    },
                ) as resp:
                    assert resp.status == 200
                # print("Upload took {0} seconds".format(time.time() - t))

        # One last request to finalize the runnable workflow
        async with retry_client.post(
            f"{CW_ENDPOINT}/api/runnable-workflows/finalize_runnable_workflow",
            json={
                "runnable_workflow_key": code,
            },
        ) as resp:
            assert resp.status == 200
            resp_json = await resp.json()
            workflow_id = resp_json['workflow_id']
            version_id = resp_json['version_id']
        
        workflow_deploy_url = f"{CW_ENDPOINT}/workflows/{workflow_id}?version={version_id}"
        DEPLOY_PROGRESS = {}
        print("\n\n")
        print(f"Successfully uploaded workflow: ", workflow_deploy_url)

        # Now, return a json response with the workflow ID
        return web.json_response({"deploy_url": workflow_deploy_url})