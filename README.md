


== Embeddings ==

An embedded object lives in its parent.

- The URL for the API endpoint of the embedded object is built by based on the parent model's URL by appending the embedded object's "urlSuffix" property.

=== Embedding Models ===

=== Embedding Collections ===





== References ==

- Upon assigning a reference, the referenced model is automatically fetched from the server if it has never been synced before.
- Side-loading referenced models' data is supported by nesting the JSON representation of the referenced object like this:

```

```

