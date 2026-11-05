"""
Rule-of-Two (DILI) endpoints.

Its own blueprint rather than more lines on the ~3000-line api.py, since the
tool is self-contained: one assessment endpoint and one reference-set endpoint.
The scoring rule itself lives in dashboard.services.ro2_service, not here.
"""

import logging

from flask import Blueprint, jsonify, request
from flask_login import current_user, login_required

from dashboard.services import ro2_service

logger = logging.getLogger(__name__)

ro2_bp = Blueprint('ro2', __name__)


@ro2_bp.route('/<set_id>', methods=['GET'])
@login_required
def assess(set_id):
    """
    Full quadrant payload for one label: the reference cloud, the drug's own
    point, and why it may not be scoreable.

    Slow by nature -- it resolves a structure from PubChem and reads the dose
    with an LLM -- so the client shows the reference cloud while it waits.
    """
    try:
        user = current_user._get_current_object() if current_user.is_authenticated else None
        return jsonify(ro2_service.assess(user, set_id)), 200
    except Exception as exc:
        logger.exception('Rule-of-Two assessment failed for %s', set_id)
        return jsonify({'error': f'Assessment failed: {exc}'}), 500


@ro2_bp.route('/reference', methods=['GET'])
@login_required
def reference():
    """The background cloud on its own, for a first paint with no waiting."""
    try:
        points, provenance = ro2_service.reference_points()
        return jsonify({
            'reference': points,
            'reference_provenance': provenance,
            'thresholds': {
                'max_daily_dose_mg': ro2_service.DOSE_THRESHOLD_MG,
                'alogp': ro2_service.ALOGP_THRESHOLD,
            },
        }), 200
    except Exception as exc:
        logger.exception('Rule-of-Two reference fetch failed')
        return jsonify({'error': f'Reference set unavailable: {exc}'}), 500


@ro2_bp.route('/<set_id>/structure', methods=['GET'])
@login_required
def structure(set_id):
    """
    Identity, structure and ALogP -- everything except the dose.

    One PubChem round trip, so it lands in about a second. The page requests
    this in parallel with the dose so lipophilicity is on screen long before
    the LLM finishes reading the label.
    """
    try:
        return jsonify(ro2_service.structure_stage(set_id)), 200
    except Exception as exc:
        logger.exception('Rule-of-Two structure stage failed for %s', set_id)
        return jsonify({'error': f'Structure lookup failed: {exc}'}), 500


@ro2_bp.route('/<set_id>/dose', methods=['GET'])
@login_required
def dose(set_id):
    """
    The maximum daily dose, read out of the label by the LLM.

    Tens of seconds in the worst case. Requested on its own so nothing else on
    the page waits behind it.
    """
    try:
        user = current_user._get_current_object() if current_user.is_authenticated else None
        return jsonify(ro2_service.dose_stage(user, set_id)), 200
    except Exception as exc:
        logger.exception('Rule-of-Two dose stage failed for %s', set_id)
        return jsonify({'error': f'Dose extraction failed: {exc}'}), 500


@ro2_bp.route('/score', methods=['POST'])
@login_required
def rescore():
    """
    Re-apply the rule to a user-supplied dose.

    The client could compare against the exported thresholds itself, and does
    so live while typing; this exists so a corrected dose can be scored by the
    same code path that scored the extracted one.
    """
    payload = request.get_json(silent=True) or {}
    dose = payload.get('max_daily_dose_mg')
    alogp = payload.get('alogp')
    try:
        dose = float(dose) if dose is not None else None
        alogp = float(alogp) if alogp is not None else None
    except (TypeError, ValueError):
        return jsonify({'error': 'max_daily_dose_mg and alogp must be numbers.'}), 400

    result = ro2_service.score(dose, alogp)
    result['dose_source'] = 'user-entered'
    return jsonify(result), 200
