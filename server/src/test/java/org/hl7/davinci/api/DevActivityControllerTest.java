package org.hl7.davinci.api;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.hl7.davinci.api.DevActivityController.ActivityEvent;
import org.junit.jupiter.api.Test;

class DevActivityControllerTest {

  private static ActivityEvent event(String id) {
    return new ActivityEvent(id, 0L, "inbound", "POST", "/x", 200, "op", "cat", null, null);
  }

  @Test
  void record_evictsOldestBeyondCapacity() {
    DevActivityController controller = new DevActivityController();
    for (int i = 0; i < 205; i++) {
      controller.record(event("e" + i));
    }
    assertEquals(200, controller.list().size());
    assertEquals("e5", controller.list().get(0).id());
    assertEquals("e204", controller.list().get(199).id());
  }
}
