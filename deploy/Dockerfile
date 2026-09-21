FROM ubuntu:24.04
COPY gharawi-todo /usr/local/bin/gharawi-todo
USER 65532:65532
ENV TODO_LISTEN=0.0.0.0:8080 TODO_DB=/data/todo.db
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/gharawi-todo"]
