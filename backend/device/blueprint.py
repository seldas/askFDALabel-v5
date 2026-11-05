from flask import Blueprint, jsonify, request
from dashboard.services.ai_handler import call_llm
from device.services.device_client import find_devices, get_device_metadata, get_device_ifu
from device.services.maude_analyzer import get_maude_summary
from device.services.recall_analyzer import get_device_recalls

device_bp = Blueprint('device', __name__)

import random

@device_bp.route('/random', methods=['GET'])
def random_devices():
    queries = ['Stent', 'Pacemaker', 'Intuitive Surgical', 'Infusion Pump', 'Orthopedic', 'Laser', 'Ultrasound']
    q = random.choice(queries)
    results, total = find_devices(q, skip=0, limit=5)
    if isinstance(results, dict) and "error" in results:
        return jsonify({'results': [], 'total': 0, 'error': results["error"]})
    return jsonify({'results': results, 'total': len(results)})

@device_bp.route('/search', methods=['GET'])
def search_devices():
    query = request.args.get('q', '')
    skip = int(request.args.get('skip', 0))
    limit = int(request.args.get('limit', 10))
    
    if not query:
        return jsonify({'results': [], 'total': 0})
        
    results, total = find_devices(query, skip=skip, limit=limit)
    if isinstance(results, dict) and "error" in results:
        return jsonify({'results': [], 'total': 0, 'error': results["error"]})
    return jsonify({'results': results, 'total': total})

@device_bp.route('/metadata/<id>', methods=['GET'])
def device_metadata(id):
    metadata = get_device_metadata(id)
    if not metadata:
        return jsonify({'error': 'Device not found'}), 404
    return jsonify(metadata)

@device_bp.route('/maude/<product_code>', methods=['GET'])
def maude_report(product_code):
    data = get_maude_summary(product_code)
    if not data:
        return jsonify({'error': 'MAUDE data not found'}), 404
    return jsonify(data)

@device_bp.route('/safety/<product_code>', methods=['GET'])
def device_safety_analysis(product_code):
    k_number = request.args.get('id')
    summary = get_maude_summary(product_code, k_number=k_number)
    if not summary:
        return jsonify({'error': 'Safety data not found'}), 404
    return jsonify(summary)

@device_bp.route('/recalls/<product_code>', methods=['GET'])
def device_recalls(product_code):
    k_number = request.args.get('id')
    summary = get_device_recalls(product_code, k_number=k_number)
    if not summary:
        return jsonify({'error': 'Recall data not found'}), 404
    return jsonify(summary)

@device_bp.route('/compare', methods=['GET'])
def compare_devices():
    id1 = request.args.get('id1')
    id2 = request.args.get('id2')
    
    if not id1 or not id2:
        return jsonify({'error': 'Both id1 and id2 are required.'}), 400
        
    ifu1 = get_device_ifu(id1)
    ifu2 = get_device_ifu(id2)
    
    prompt = (
        "You are an FDA regulatory expert. I have the 'Indications for Use' (IFU) for two medical devices. "
        "Compare them and summarize the key clinical and operational differences in 3-4 bullet points. "
        "Return the response in raw HTML format starting directly with an <h3> tag."
    )
    user_msg = f"--- Device 1 ({id1}) IFU ---\n{ifu1}\n\n--- Device 2 ({id2}) IFU ---\n{ifu2}"
    
    # We pass None for user, or we can just call it
    analysis = call_llm(None, prompt, user_msg)
    
    return jsonify({
        'device1': {'id': id1, 'ifu': ifu1},
        'device2': {'id': id2, 'ifu': ifu2},
        'comparison': analysis
    })

@device_bp.route('/analyze', methods=['POST'])
def analyze_device_label():
    # Placeholder for AI analysis of device labeling (IFUs)
    data = request.json
    text = data.get('text', '')
    prompt = f"Analyze this medical device labeling for safety considerations: {text}"
    analysis = call_llm(None, prompt, text)
    return jsonify({'analysis': analysis})
