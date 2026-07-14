package org.hl7.davinci.api;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;

import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import com.fasterxml.jackson.databind.JsonNode;

/**
 * Developer-facing feed of server-to-server exchanges that never touch the browser (e.g. inbound
 * PAS subscription notifications). The SPA merges these into its dev-tools network drawer so users
 * of this reference implementation can observe background traffic. In-memory only, like the rest
 * of the server's state.
 */
@RestController
@RequestMapping("/api/dev/activity")
public class DevActivityController {

  public record ActivityEvent(
      String id,
      long timestamp,
      String direction,
      String method,
      String url,
      int status,
      String operationName,
      String category,
      JsonNode requestBody,
      JsonNode responseBody) {}

  private static final int MAX_EVENTS = 200;

  private final Deque<ActivityEvent> events = new ArrayDeque<>();
  private final List<SseEmitter> emitters = new CopyOnWriteArrayList<>();

  public void record(ActivityEvent event) {
    synchronized (events) {
      events.addLast(event);
      if (events.size() > MAX_EVENTS) {
        events.removeFirst();
      }
    }
    for (SseEmitter emitter : emitters) {
      try {
        emitter.send(SseEmitter.event().name("activity").data(event, MediaType.APPLICATION_JSON));
      } catch (Exception e) {
        emitters.remove(emitter);
      }
    }
  }

  @GetMapping
  public List<ActivityEvent> list() {
    synchronized (events) {
      return new ArrayList<>(events);
    }
  }

  @GetMapping("/stream")
  public SseEmitter stream() {
    SseEmitter emitter = new SseEmitter(0L);
    emitters.add(emitter);
    emitter.onCompletion(() -> emitters.remove(emitter));
    emitter.onTimeout(() -> emitters.remove(emitter));
    emitter.onError(e -> emitters.remove(emitter));
    try {
      // Spring only commits SSE response headers on the first write; without this the browser's
      // EventSource sits in CONNECTING (and misses events) until something else is sent.
      emitter.send(SseEmitter.event().comment("connected"));
    } catch (Exception e) {
      emitters.remove(emitter);
    }
    return emitter;
  }
}
