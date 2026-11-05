import threading
import json
import logging
from datetime import datetime, timezone
from database import db, SystemTask

logger = logging.getLogger(__name__)

class TaskService:
    @staticmethod
    def create_task(task_type, user_id=None, project_id=None, message=None):
        """Create a new SystemTask record in the database."""
        task = SystemTask(
            task_type=task_type,
            user_id=user_id,
            project_id=project_id,
            message=message or f"Starting {task_type} task...",
            status='pending',
            progress=0
        )
        db.session.add(task)
        db.session.commit()
        return task

    @staticmethod
    def update_task(task_id, progress=None, message=None, status=None, result_data=None, error_details=None):
        """Update an existing SystemTask record."""
        # Use a new session to avoid issues with background threads
        task = SystemTask.query.get(task_id)
        if not task:
            logger.error(f"Task {task_id} not found for update.")
            return None

        if progress is not None:
            task.progress = progress
        if message:
            task.message = message
        if status:
            task.status = status
            if status in ['completed', 'failed']:
                task.completed_at = datetime.now(timezone.utc).replace(tzinfo=None)
        if result_data:
            task.result_data = json.dumps(result_data) if isinstance(result_data, (dict, list)) else result_data
        if error_details:
            task.error_details = error_details

        db.session.commit()
        return task

    @staticmethod
    def start_background_task(app, task_id, target_fn, *args, **kwargs):
        """Run a function via Celery queue."""
        try:
            # celery_app constructs a worker Flask app at import time, including
            # create_all(). A web request must only publish a message; importing
            # that worker here could race startup DDL and strand a pending task.
            from celery import Celery
            TaskService.update_task(task_id, status='processing')
            with Celery(
                app.import_name,
                broker=app.config.get('CELERY_BROKER_URL', 'redis://localhost:6379/0'),
                backend=app.config.get('CELERY_RESULT_BACKEND', 'redis://localhost:6379/0'),
            ) as producer:
                producer.conf.broker_connection_timeout = 5
                producer.conf.broker_transport_options = {
                    **(producer.conf.broker_transport_options or {}),
                    'socket_connect_timeout': 5,
                    'socket_timeout': 5,
                }
                producer.send_task(
                    'execute_generic_task',
                    args=[target_fn.__module__, target_fn.__name__, task_id, *args],
                    kwargs=kwargs,
                    retry=False,
                )
        except Exception as e:
            logger.error(f"Failed to dispatch task to Celery: {e}", exc_info=True)
            TaskService.update_task(task_id, status='failed', error_details=str(e))
        return None
