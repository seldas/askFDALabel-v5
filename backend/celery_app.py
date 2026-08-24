import os
from celery import Celery
from app import create_unified_app

def make_celery(app):
    celery = Celery(
        app.import_name,
        backend=app.config.get('CELERY_RESULT_BACKEND', 'redis://localhost:6379/0'),
        broker=app.config.get('CELERY_BROKER_URL', 'redis://localhost:6379/0')
    )
    celery.conf.update(app.config)

    class ContextTask(celery.Task):
        def __call__(self, *args, **kwargs):
            with app.app_context():
                return self.run(*args, **kwargs)

    celery.Task = ContextTask
    return celery

flask_app = create_unified_app()
celery = make_celery(flask_app)

@celery.task(name='execute_generic_task')
def execute_generic_task(module_name, function_name, task_id, *args, **kwargs):
    import importlib
    module = importlib.import_module(module_name)
    target_fn = getattr(module, function_name)
    return target_fn(task_id, *args, **kwargs)
