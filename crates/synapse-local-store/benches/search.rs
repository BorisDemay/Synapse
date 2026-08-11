use criterion::{Criterion, criterion_group, criterion_main};
use synapse_core::{ContentHash, NoteId, Revision, VaultPath};
use synapse_local_store::{IndexedNote, LocalStore};

fn note_at(index: usize, total: usize) -> IndexedNote {
    let next = (index + 1) % total;
    let content = format!(
        "---\ntags: [bench]\n---\n\n# Note {index}\n\nKeyword token{index} and synapse.\n\n[[note-{next:05}]]\n"
    );
    IndexedNote {
        note_id: NoteId::new(),
        path: VaultPath::parse(&format!("notes/note-{index:05}.md")).expect("path"),
        content_hash: ContentHash::from_bytes(content.as_bytes()),
        content,
        revision: Revision::new(1).expect("revision"),
        updated_at: index as i64,
    }
}

fn index_and_search(criterion: &mut Criterion) {
    let total = 10_000usize;
    let store = LocalStore::open_in_memory().expect("store");
    for index in 0..total {
        store.upsert_note(&note_at(index, total)).expect("upsert");
    }

    criterion.bench_function("search_paths_token_mid", |bencher| {
        bencher.iter(|| {
            let hits = store
                .search_paths_limited("token5000", 20)
                .expect("search");
            assert!(!hits.is_empty());
        });
    });

    criterion.bench_function("search_paths_shared_term", |bencher| {
        bencher.iter(|| {
            let hits = store.search_paths_limited("synapse", 50).expect("search");
            assert_eq!(hits.len(), 50);
        });
    });
}

fn upsert_throughput(criterion: &mut Criterion) {
    criterion.bench_function("upsert_note_1000", |bencher| {
        bencher.iter(|| {
            let store = LocalStore::open_in_memory().expect("store");
            for index in 0..1_000 {
                store.upsert_note(&note_at(index, 1_000)).expect("upsert");
            }
        });
    });
}

criterion_group!(benches, index_and_search, upsert_throughput);
criterion_main!(benches);
