import importlib.util
from pathlib import Path
import tempfile
import os
import stat
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('sync_art', Path(__file__).with_name('sync_art.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class ArtSyncTests(unittest.TestCase):
    def test_filter(self):
        yes = ['Assets/Character/A/Design/A.jpg', 'Assets/其他设计/A.png',
               'Assets/Scence/A/Design/参考/board.tiff']
        no = ['Assets/Character/A/Texture/A.jpg', 'Assets/Character/A/Shading/A.jpg',
              'Assets/Character/A/Design/A.psd', 'Assets/Character/A/Design/A.mp4',
              'Assets/Character/A/Design/Textures/A.jpg']
        for path in yes:
            self.assertTrue(m.art_file(path), path)
        for path in no:
            self.assertFalse(m.art_file(path), path)

    def test_reject_escape(self):
        for path in ['../Assets/a.jpg', 'Assets/../a.jpg', 'C:/Assets/a.jpg',
                     '/Assets/a.jpg', 'EP001/a.jpg', 'Assets/a.jpg:stream', 'Assets//a.jpg']:
            with self.assertRaises(ValueError, msg=path):
                m.path_parts(path)

    def test_missing_only_compare(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            existing = root / 'Character/A/Design/old.jpg'
            existing.parent.mkdir(parents=True)
            existing.write_bytes(b'preserved')
            def row(name):
                return {'packageName': 'Assets/Character/A/Design/' + name,
                        'file': {'fileId': name, 'serverPath': '/blob/' + name,
                                 'size': 123, 'mtime': 0}}
            result = m.compare([row('old.jpg'), row('new.jpg')], root)
            self.assertEqual(len(result['missing']), 1)
            self.assertEqual(len(result['local_newer']), 1)
            self.assertEqual(existing.read_bytes(), b'preserved')

    def test_atomic_publish_no_overwrite(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            stage = root / 'stage'
            dest = root / 'target/new.jpg'
            stage.write_bytes(b'new image bytes')
            m.publish_new(stage, dest)
            self.assertEqual(dest.read_bytes(), stage.read_bytes())
            stage.write_bytes(b'changed stage')
            self.assertEqual(dest.read_bytes(), b'new image bytes')
            with self.assertRaises(FileExistsError):
                m.publish_new(stage, dest)
            self.assertEqual(dest.read_bytes(), b'new image bytes')
            self.assertEqual(list(dest.parent.glob('.art-sync-*')), [])

    def test_rollback_verified_new_only(self):
        with tempfile.TemporaryDirectory() as d:
            run = Path(d) / 'run'
            target = Path(d) / 'Assets'
            target.mkdir()
            package = 'Assets/Character/A/Design/new.png'
            dest = m.target_path(target, package)
            dest.parent.mkdir(parents=True)
            dest.write_bytes(b'new file')
            before = m.digest(dest)
            m.dump(run / 'run.json', {'target': str(target)})
            m.dump(run / 'created.json', [{'packageName': package, 'localPath': str(dest), 'sha256': before}])
            result = m.rollback(run)
            self.assertEqual(len(result['would_remove']), 1)
            self.assertTrue(dest.exists())
            dest.write_bytes(b'edited by artist')
            result = m.rollback(run, True)
            self.assertEqual(len(result['modified_preserved']), 1)
            self.assertTrue(dest.exists())
            dest.write_bytes(b'new file')
            result = m.rollback(run, True)
            self.assertEqual(len(result['removed']), 1)
            self.assertFalse(dest.exists())

    def test_pagination_incomplete_rejected(self):
        class Client:
            def _post(self, endpoint, payload):
                return {'total': 4, 'records': []}
        with self.assertRaises(ValueError):
            m.file_snapshot(Client(), 8, [{'id': 1, 'path': 'Assets/Character/A/Design'}])

    def test_server_tree_discovers_new_assets_and_prunes_production(self):
        class Client:
            called = []
            def _post(self, endpoint, payload=None):
                def node(i, path):
                    return {'id': i, 'path': path, 'deleted': 0}
                if 'getByPath' in endpoint:
                    return [node(1, 'Assets')]
                i = int(endpoint.rsplit('=', 1)[1])
                self.called.append(i)
                return {1: [node(2, 'Assets/Character')],
                        2: [node(3, 'Assets/Character/NewAsset')],
                        3: [node(4, 'Assets/Character/NewAsset/Design'),
                            node(5, 'Assets/Character/NewAsset/Modeling')],
                        4: []}[i]
        client = Client()
        dirs = m.directory_snapshot(client, 8)
        self.assertEqual({x['id'] for x in dirs}, {1, 2, 3, 4})
        self.assertNotIn(5, client.called)

    def test_all_file_pages_read(self):
        class Client:
            def _post(self, endpoint, payload):
                page = payload['pageNum']
                nums = [1, 2] if page == 1 else [3]
                return {'total': 3, 'records': [
                    {'id': i, 'packageName': f'Assets/Character/A/Design/{i}.png',
                     'file': {'size': 5, 'fileId': str(i)}} for i in nums]}
        rows = m.file_snapshot(Client(), 8, [{'id': 1, 'path': 'Assets/Character/A/Design'}])
        self.assertEqual([x['id'] for x in rows], [1, 2, 3])

    def test_duplicate_path_conflict_rejected(self):
        class Client:
            def _post(self, endpoint, payload):
                return {'total': 2, 'records': [
                    {'id': i, 'packageName': 'Assets/Character/A/Design/A.png',
                     'file': {'size': i, 'fileId': str(i)}} for i in [1, 2]]}
        with self.assertRaises(ValueError):
            m.file_snapshot(Client(), 8, [{'id': 1, 'path': 'Assets/Character/A/Design'}])

    def test_image_validation(self):
        from PIL import Image
        with tempfile.TemporaryDirectory() as d:
            image = Path(d) / 'a.png'
            Image.new('RGB', (3, 4), 'red').save(image)
            check = m.verify_image(image, {'size': image.stat().st_size})
            self.assertEqual(check['dimensions'], [3, 4])
            with self.assertRaises(ValueError):
                m.verify_image(image, {'size': image.stat().st_size + 1})

    def test_large_board_threshold_restored(self):
        from PIL import Image
        with tempfile.TemporaryDirectory() as d:
            image = Path(d) / 'board.png'
            Image.new('RGB', (3, 4), 'blue').save(image)
            original = Image.MAX_IMAGE_PIXELS
            try:
                Image.MAX_IMAGE_PIXELS = 1
                self.assertEqual(m.verify_image(image, {'size': image.stat().st_size})['dimensions'], [3, 4])
                self.assertEqual(Image.MAX_IMAGE_PIXELS, 1)
            finally:
                Image.MAX_IMAGE_PIXELS = original

    def test_resume_reuses_staging_without_transfer(self):
        from PIL import Image
        class Helper:
            @staticmethod
            def ensure_transfer_client_running():
                raise AssertionError('complete staging should not start a transfer')
            class ZynnTransferDispatcher:
                def submit_download_tasks(self, tasks):
                    raise AssertionError('complete staging should not be re-downloaded')
        with tempfile.TemporaryDirectory() as d:
            target = Path(d) / 'Assets'
            target.mkdir()
            run = Path(d) / 'run'
            package = 'Assets/Character/A/Design/new.png'
            stage = m.target_path(run / 'staging/Assets', package)
            stage.parent.mkdir(parents=True)
            Image.new('RGB', (3, 4), 'green').save(stage)
            item = {'packageName': package, 'id': 'blob1', 'serverPath': '/blob/1',
                    'serverCode': 'disk2', 'size': stage.stat().st_size, 'mtime': 0}
            with patch.object(m.time, 'sleep', return_value=None):
                created = m.download_missing(Helper, {'missing': [item]}, run, target, 10)
            self.assertEqual(len(created), 1)
            self.assertEqual(m.digest(stage), m.digest(m.target_path(target, package)))

    def test_newer_server_replaces_readonly_old_without_backup(self):
        from PIL import Image
        class Helper:
            @staticmethod
            def ensure_transfer_client_running():
                raise AssertionError('staging already complete')
            class ZynnTransferDispatcher:
                def submit_download_tasks(self, tasks):
                    raise AssertionError('staging already complete')
        with tempfile.TemporaryDirectory() as d:
            target = Path(d) / 'Assets'
            target.mkdir()
            run = Path(d) / 'run'
            package = 'Assets/Character/A/Design/a.png'
            dest = m.target_path(target, package)
            dest.parent.mkdir(parents=True)
            Image.new('RGB', (3, 4), 'red').save(dest)
            old_bytes = dest.read_bytes()
            os.utime(dest, (100, 100))
            os.chmod(dest, stat.S_IREAD)
            stage = m.target_path(run / 'staging/Assets', package)
            stage.parent.mkdir(parents=True)
            Image.new('RGB', (3, 4), 'blue').save(stage)
            new_bytes = stage.read_bytes()
            rows = [{'packageName': package, 'file': {'fileId': 'new', 'serverPath': '/blob/new',
                     'size': stage.stat().st_size, 'mtime': 200}}]
            diff = m.compare(rows, target)
            self.assertEqual(len(diff['needs_update']), 1)
            with patch.object(m.time, 'sleep', return_value=None):
                result = m.sync_images(Helper, diff, run, target, 10)
            self.assertEqual(len(result['updated']), 1)
            self.assertEqual(len(result['created']), 0)
            self.assertEqual(dest.read_bytes(), new_bytes)
            self.assertNotEqual(dest.read_bytes(), old_bytes)
            self.assertEqual(list(dest.parent.iterdir()), [dest])
            self.assertTrue(all(p.read_bytes() != old_bytes for p in run.rglob('*') if p.is_file()))
            self.assertEqual(len(m.compare(rows, target)['needs_update']), 0)
            m.dump(run / 'run.json', {'target': str(target)})
            rolled = m.rollback(run, True)
            self.assertEqual(len(rolled['replacements_retained_no_old_copy']), 1)
            self.assertEqual(dest.read_bytes(), new_bytes)

    def test_replacement_preserves_file_changed_after_scan(self):
        with tempfile.TemporaryDirectory() as d:
            dest = Path(d) / 'old.png'
            stage = Path(d) / 'stage.png'
            dest.write_bytes(b'old')
            s = dest.stat()
            before = {'size': s.st_size, 'mtime_ns': s.st_mtime_ns, 'sha256': m.digest(dest)}
            dest.write_bytes(b'artist edited after scan')
            stage.write_bytes(b'server bytes')
            with self.assertRaises(ValueError):
                m.publish_replacement(stage, dest, before)
            self.assertEqual(dest.read_bytes(), b'artist edited after scan')

    def test_local_newer_not_downgraded_and_equal_time_size_mismatch_updated(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            p = root / 'Character/A/Design/a.png'
            p.parent.mkdir(parents=True)
            p.write_bytes(b'local')
            os.utime(p, (200, 200))
            row = {'packageName': 'Assets/Character/A/Design/a.png',
                   'file': {'fileId': 'server', 'serverPath': '/blob/server', 'size': 100, 'mtime': 100}}
            self.assertEqual(len(m.compare([row], root)['local_newer']), 1)
            row['file']['mtime'] = 200
            self.assertEqual(len(m.compare([row], root)['needs_update']), 1)


if __name__ == '__main__':
    unittest.main()
