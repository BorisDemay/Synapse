fn main() {
    let document = serde_json::to_string_pretty(&synapse_protocol::v1::openapi_document())
        .expect("serializes");
    println!("{document}");
}
