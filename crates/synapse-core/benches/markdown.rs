use criterion::{BenchmarkId, Criterion, Throughput, criterion_group, criterion_main};
use synapse_core::parse_note;

fn sample_note(index: usize, body_kib: usize) -> String {
    let filler = "lorem synapse token ".repeat(body_kib.max(1) * 12);
    format!(
        "---\ntags: [bench, n{index}]\n---\n\n# Heading {index}\n\nSee [[note-{:05}]] and [[other|alias]].\n\n{filler}\n",
        (index + 1) % 1_000
    )
}

fn parse_incremental(criterion: &mut Criterion) {
    let mut group = criterion.benchmark_group("parse_note");
    for kib in [1usize, 8, 64] {
        let source = sample_note(42, kib);
        group.throughput(Throughput::Bytes(source.len() as u64));
        group.bench_with_input(
            BenchmarkId::new("bytes_kib", kib),
            &source,
            |bencher, source| {
                bencher.iter(|| parse_note(source).expect("parse"));
            },
        );
    }
    group.finish();
}

fn parse_batch_1k(criterion: &mut Criterion) {
    let notes: Vec<String> = (0..1_000).map(|index| sample_note(index, 2)).collect();
    criterion.bench_function("parse_note_batch_1000", |bencher| {
        bencher.iter(|| {
            for note in &notes {
                parse_note(note).expect("parse");
            }
        });
    });
}

criterion_group!(benches, parse_incremental, parse_batch_1k);
criterion_main!(benches);
